import { prisma } from "@/lib/prisma";
import { searchPortraitClips } from "@/lib/visuals/pexels";
import type { StageContext, StageResult } from "./context";
import type { ClipPick, ReelScript } from "@/lib/reels/types";
import { fetchPublicBytes } from "@/lib/security/fetch-public";
import { generateJson, type MediaInput } from "@/lib/ai/gemini";

const MAX_ROUNDS = 3;

async function previewFrames(pick: ClipPick): Promise<MediaInput[]> {
  const frames = await Promise.all(
    pick.chosen.previewImages.slice(0, 2).map(
      (url): Promise<MediaInput | null> =>
        fetchPublicBytes(url, { maxBytes: 2 * 1024 * 1024, timeoutMs: 15_000 })
          .then(({ bytes, contentType }) => ({ kind: "image" as const, data: bytes, mimeType: contentType ?? "image/jpeg" }))
          .catch(() => null),
    ),
  );
  return frames.filter((f): f is MediaInput => f !== null);
}

/** Stages normally return their result; a failing run saves its partial progress here. */
async function saveProgress(projectId: string, picks: ClipPick[]) {
  await prisma.reelProject.update({ where: { id: projectId }, data: { clips: picks as unknown as object } });
}

/** Swaps in the next alternate (or a fresh search) after a rejection. False when nothing is left. */
async function replace(pick: ClipPick, taken: Set<number>, fallbackQuery: string): Promise<boolean> {
  const tried = new Set([...pick.rejected.map((r) => r.id), ...taken]);
  let next = pick.alternates.find((c) => !tried.has(c.id));
  if (!next) {
    const fresh = await searchPortraitClips(fallbackQuery, 8);
    next = fresh.find((c) => !tried.has(c.id));
  }
  if (!next) return false;
  taken.delete(pick.chosen.id);
  taken.add(next.id);
  pick.alternates = pick.alternates.filter((c) => c.id !== next!.id);
  pick.chosen = next;
  return true;
}


export async function runSafetyStage({ project, idea }: StageContext): Promise<StageResult> {
  const picks = project.clips as unknown as ClipPick[] | null;
  const script = project.script as ReelScript | null;
  if (!picks?.length || !script) throw new Error("The project has no footage picked yet.");
  const taken = new Set(picks.map((p) => p.chosen.id));

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const pending = picks.filter((p) => !p.approved);
    if (pending.length === 0) break;

    const frames = await Promise.all(pending.map(previewFrames));
    const media: MediaInput[] = [];
    const lines: string[] = [];
    pending.forEach((pick, k) => {
      if (frames[k].length === 0) return;
      const first = media.length + 1;
      media.push(...frames[k]);
      lines.push(
        `Clip ${k}: images ${first}-${media.length}. Narration over it: "${script.sentences[pick.sentence]?.text ?? ""}"`,
      );
    });

    const verdicts = new Map<number, { safe: boolean; fits: boolean; reason: string }>();
    if (media.length > 0) {
      const result = await generateJson<{ verdicts: { clip: number; safe: boolean; fits: boolean; reason: string }[] }>({
        prompt: [
          `You check stock-footage clips before they go into an original Instagram reel that will be monetised.`,
          `The attached images are still frames, numbered in order. They belong to these clips:`,
          ...lines,
          ``,
          `For each clip decide:`,
          `- "safe": false if any frame shows a watermark or stock-agency mark, a TV channel logo or on-screen graphics, a sports broadcast, a scene from a movie/TV show/game, a readable brand logo or product advertising, another creator's captions or text overlay, a recognisable celebrity or famous person, nudity, gore or violence. Ordinary unnamed people, nature, space imagery, cities and objects are safe.`,
          `- "fits": false if the picture fits neither its narration nor the reel's topic ("${idea.niche.name}"), e.g. sports or fashion footage under a space fact. A loosely related scene with the right mood is fine.`,
          `- "reason": a few words.`,
        ].join("\n"),
        media,
        schema: {
          type: "object",
          properties: {
            verdicts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  clip: { type: "integer" },
                  safe: { type: "boolean" },
                  fits: { type: "boolean" },
                  reason: { type: "string" },
                },
                required: ["clip", "safe", "fits", "reason"],
              },
            },
          },
          required: ["verdicts"],
        },
      });
      for (const v of result.verdicts ?? []) verdicts.set(v.clip, v);
    }

    for (const [k, pick] of pending.entries()) {
      const verdict = verdicts.get(k);
      if (verdict?.safe && verdict.fits) {
        pick.approved = true;
        continue;
      }
      // No preview frames or no verdict counts as a rejection: unchecked footage never goes out.
      const reason = !frames[k].length ? "no preview frames" : (verdict?.reason ?? "not checked");
      pick.rejected.push({ id: pick.chosen.id, reason });
      if (!(await replace(pick, taken, idea.niche.name))) {
        await saveProgress(project.id, picks);
        throw new Error(
          `No safe footage left for sentence ${pick.sentence + 1} ("${pick.query}"). Last rejection: ${reason}. Use "New footage" to search again.`,
        );
      }
    }
  }

  const unchecked = picks.filter((p) => !p.approved);
  if (unchecked.length) {
    await saveProgress(project.id, picks);
    throw new Error(`Footage for ${unchecked.length} sentence(s) still needs checking. Retrying with other clips.`);
  }
  return { clips: picks as unknown as object };
}
