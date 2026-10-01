import { prisma } from "@/lib/prisma";
import { searchClips } from "@/lib/visuals/search";
import { clipKey } from "@/lib/visuals/types";
import type { Niche } from "@prisma/client";
import { queriesFor } from "./visuals";
import type { StageContext, StageResult } from "./context";
import type { ClipPick, ReelScript } from "@/lib/reels/types";
import { fetchPublicBytes } from "@/lib/security/fetch-public";
import { ai } from "@/lib/ai/router";
import type { MediaInput } from "@/lib/ai/gemini";

const MAX_ROUNDS = 3;
const BATCH_SIZE = 3;

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

/**
 * Swaps in the next alternate after a rejection, else searches every library
 * that suits the niche again with broader queries (the original query would
 * mostly return clips already tried). False when nothing is left.
 */
async function replace(pick: ClipPick, taken: Set<string>, niche: Niche, userId: string): Promise<boolean> {
  // Rejections saved before there were several libraries have no source: they were Pexels.
  const tried = new Set([...pick.rejected.map((r) => clipKey({ source: r.source, id: r.id })), ...taken]);
  let next = pick.alternates.find((c) => !tried.has(clipKey(c)));
  for (const q of next ? [] : queriesFor(pick.query, niche.name)) {
    [next] = await searchClips(q, { niche, direction: pick.direction, needSec: 3, exclude: tried, limit: 6, userId });
    if (next) break;
  }
  if (!next) return false;
  // A safe backup stays reserved so another sentence can't take it.
  if (!pick.fallback || clipKey(pick.fallback) !== clipKey(pick.chosen)) taken.delete(clipKey(pick.chosen));
  taken.add(clipKey(next));
  const chosenNext = next;
  pick.alternates = pick.alternates.filter((c) => clipKey(c) !== clipKey(chosenNext));
  pick.chosen = next;
  return true;
}

/** Settles on the safe backup clip, if there is one. */
function settleOnFallback(pick: ClipPick): boolean {
  if (!pick.fallback) return false;
  if (clipKey(pick.chosen) !== clipKey(pick.fallback)) {
    pick.alternates = [pick.chosen, ...pick.alternates.filter((c) => clipKey(c) !== clipKey(pick.chosen))];
    pick.chosen = pick.fallback;
  }
  pick.approved = true;
  return true;
}

/** One Gemini request judging a few clips from their preview frames. */
function checkBatch(lines: string[], media: MediaInput[], niche: string) {
  return ai.generateJson<{ verdicts: { clip: number; safe: boolean; fits: boolean; reason: string }[] }>({
    prompt: [
      `You check stock-footage clips before they go into an original Instagram reel that will be monetised.`,
      `The attached images are still frames, numbered in order. They belong to these clips:`,
      ...lines,
      ``,
      `For each clip decide:`,
      `- "safe": false if any frame shows a watermark or stock-agency mark, a TV channel logo or on-screen graphics, a sports broadcast, a scene from a movie/TV show/game, a readable brand logo or product advertising, another creator's captions or text overlay, a recognisable celebrity or famous person, nudity, gore or violence. Ordinary unnamed people, nature, space imagery, cities and objects are safe.`,
      `- "fits": false if the picture does not support its exact narration and shot direction or the reel's topic ("${niche}"). Prefer footage that visibly matches the requested action over generic footage that only matches the topic.`,
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
}

export async function runSafetyStage({ project, idea }: StageContext): Promise<StageResult> {
  const picks = project.clips as unknown as ClipPick[] | null;
  const script = project.script as ReelScript | null;
  if (!picks?.length || !script) throw new Error("The project has no footage picked yet.");
  const taken = new Set(picks.map((p) => clipKey(p.chosen)));

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const pending = picks.filter((p) => !p.approved);
    if (pending.length === 0) break;

    const frames = await Promise.all(pending.map(previewFrames));
    const verdicts = new Map<number, { safe: boolean; fits: boolean; reason: string }>();
    // Small batches: one request with every clip's frames regularly ran past Gemini's timeout.
    for (let start = 0; start < pending.length; start += BATCH_SIZE) {
      const media: MediaInput[] = [];
      const lines: string[] = [];
      for (let k = start; k < Math.min(start + BATCH_SIZE, pending.length); k++) {
        if (frames[k].length === 0) continue;
        const first = media.length + 1;
        media.push(...frames[k]);
        lines.push(
          `Clip ${k}: images ${first}-${media.length}. Beat: ${script.sentences[pending[k].sentence]?.beat ?? "scene"}. Shot direction: "${pending[k].direction ?? pending[k].query}". Narration: "${script.sentences[pending[k].sentence]?.text ?? ""}"`,
        );
      }
      if (media.length === 0) continue;
      let result: { verdicts: { clip: number; safe: boolean; fits: boolean; reason: string }[] };
      try {
        result = await checkBatch(lines, media, idea.niche.name);
      } catch (err) {
        // Keep clips approved so far, so the retry only checks what's left.
        for (const [k, pick] of pending.entries()) {
          const v = verdicts.get(k);
          if (v?.safe && v.fits) pick.approved = true;
        }
        await saveProgress(project.id, picks);
        throw err;
      }
      for (const v of result.verdicts ?? []) verdicts.set(v.clip, v);
    }

    for (const [k, pick] of pending.entries()) {
      const verdict = verdicts.get(k);
      if (verdict?.safe && verdict.fits) {
        pick.approved = true;
        continue;
      }
      // Safe but off-script: keep it as a backup and keep looking for a better match.
      if (verdict?.safe && !pick.fallback) pick.fallback = pick.chosen;
      // No preview frames or no verdict counts as a rejection: unchecked footage never goes out.
      const reason = !frames[k].length ? "no preview frames" : (verdict?.reason ?? "not checked");
      pick.rejected.push({ id: pick.chosen.id, source: pick.chosen.source, reason });
      if (!(await replace(pick, taken, idea.niche, project.userId))) {
        if (settleOnFallback(pick)) continue;
        await saveProgress(project.id, picks);
        throw new Error(
          `No safe footage left for sentence ${pick.sentence + 1} ("${pick.query}"). Last rejection: ${reason}. Use "New footage" to search again.`,
        );
      }
    }
  }

  // Out of rounds: a safe clip that loosely fits beats failing the whole reel.
  for (const pick of picks) if (!pick.approved) settleOnFallback(pick);
  const unchecked = picks.filter((p) => !p.approved);
  if (unchecked.length) {
    await saveProgress(project.id, picks);
    throw new Error(`Footage for ${unchecked.length} sentence(s) still needs checking. Retrying with other clips.`);
  }
  return { clips: picks as unknown as object };
}
