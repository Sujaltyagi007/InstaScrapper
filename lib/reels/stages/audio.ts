import path from "node:path";
import { prisma } from "@/lib/prisma";
import { buildMixArgs } from "@/lib/render/mix";
import { runFfmpeg } from "@/lib/render/ffmpeg";
import { readFile, writeFile } from "node:fs/promises";
import type { StageContext, StageResult } from "./context";
import { fetchPublicBytes } from "@/lib/security/fetch-public";
import { ai } from "@/lib/ai/router";
import type { MediaInput } from "@/lib/ai/gemini";
import type { AudioBlueprint, ReelScript, VoiceTiming } from "@/lib/reels/types";
import { CDN_FETCH_HEADERS, downloadStoredObject, uploadBuffer } from "@/lib/storage";

const MAX_SFX = 5;
const SFX_LEAD_SEC = 0.12;
const REFERENCE_SECONDS = 60;
const REFERENCE_MAX_BYTES = 40 * 1024 * 1024;

interface SourceAudioInfo {
  caption: string | null;
  audioTitle: string | null;
  audioArtist: string | null;
  audioIsOriginal: boolean | null;
  videoUrl: string | null;
}

async function referenceClip(sources: SourceAudioInfo[], workDir: string): Promise<MediaInput | null> {
  for (const [i, source] of sources.filter((s) => s.videoUrl).slice(0, 2).entries()) {
    try {
      const { bytes } = await fetchPublicBytes(source.videoUrl!, {
        maxBytes: REFERENCE_MAX_BYTES,
        timeoutMs: 25_000,
        headers: CDN_FETCH_HEADERS,
      });
      const input = `ref${i}.mp4`;
      await writeFile(path.join(workDir, input), bytes);
      await runFfmpeg(
        ["-i", input, "-vn", "-t", String(REFERENCE_SECONDS), "-ac", "1", "-ar", "16000", "-b:a", "48k", `ref${i}.mp3`],
        { cwd: workDir, timeoutMs: 30_000 },
      );
      return { kind: "audio", mimeType: "audio/mp3", data: await readFile(path.join(workDir, `ref${i}.mp3`)) };
    } catch (err) {
      // Expired CDN link, no audio track, etc. The blueprint falls back to inference.
      console.warn("[reels] reference audio unavailable:", err instanceof Error ? err.message : err);
    }
  }
  return null;
}

async function recentMusicIds(userId: string, excludeId: string): Promise<string[]> {
  const recent = await prisma.reelProject.findMany({
    where: { userId, id: { not: excludeId } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { audioBlueprint: true },
  });
  return recent
    .map((p) => (p.audioBlueprint as AudioBlueprint | null)?.music?.id)
    .filter((id): id is string => Boolean(id));
}

async function stageStoredFile(fileId: string, workDir: string, name: string): Promise<string> {
  const bytes = await downloadStoredObject(fileId);
  if (!bytes) throw new Error(`Couldn't read ${name} from storage.`);
  await writeFile(path.join(workDir, name), bytes);
  return name;
}

export async function runAudioStage({ project, idea, workDir }: StageContext): Promise<StageResult> {
  const script = project.script as ReelScript | null;
  const timing = project.voiceTiming as VoiceTiming | null;
  if (!script || !timing || !project.voiceFileId) throw new Error("The project has no voiceover yet.");

  const [sourceRows, bank, avoidMusic] = await Promise.all([
    prisma.media.findMany({
      where: { id: { in: idea.sourceMediaIds } },
      select: {
        caption: true,
        audioTitle: true,
        audioArtist: true,
        audioIsOriginal: true,
        sourceVideoUrl: true,
        videoUrl: true,
      },
    }),
    prisma.soundAsset.findMany({ where: { userId: project.userId }, orderBy: { createdAt: "asc" }, take: 200 }),
    recentMusicIds(project.userId, project.id),
  ]);
  const sources: SourceAudioInfo[] = sourceRows.map((m) => ({ ...m, videoUrl: m.sourceVideoUrl ?? m.videoUrl }));
  const music = bank.filter((s) => s.kind === "MUSIC");
  const effects = bank.filter((s) => s.kind === "SFX");
  const reference = await referenceClip(sources, workDir);

  const describeSources = sources
    .map((s) => `- sound: ${s.audioTitle ? `"${s.audioTitle}"${s.audioArtist ? ` by ${s.audioArtist}` : ""}` : "unknown"}` +
      `${s.audioIsOriginal ? " (creator's original audio)" : ""}; caption: ${(s.caption ?? "").replace(/\s+/g, " ").slice(0, 200)}`,
    ).join("\n");

  const result = await ai.generateJson<{
    reference: { genre: string; mood: string[]; bpm: number; energy: "low" | "medium" | "high"; notes: string };
    musicId: string;
    sfx: { soundId: string; sentence: number; at: "start" | "end" }[];
  }>({
    prompt: [
      `You're the sound designer for an original Instagram reel in the niche "${idea.niche.name}". Idea: ${idea.title}.`,
      `The reel is a voiceover. Its sentences, with times in seconds:`,
      ...script.sentences.map(
        (s, i) => `[${i}] ${timing.spans[i]?.start.toFixed(1)}-${timing.spans[i]?.end.toFixed(1)}s: ${s.text}`,
      ),
      ``,
      reference
        ? `The attached audio is the start of the trending reel this idea came from. Describe its feel in "reference": genre, mood words, tempo in BPM (0 if there's no beat), energy, and in "notes" how music and sound effects are used (where the beat drops, what effects hit when). We'll only match the feel with our own licensed sounds; never copy it.`
        : `No audio of the trending reel is available. Infer a fitting feel for "reference" (genre, mood words, BPM or 0, energy, notes) from the niche, the idea and what's known about the trending reels' sound:\n${describeSources || "- nothing known"}`,
      ``,
      `Then pick from the user's licensed sound bank. Only use ids from these lists.`,
      `Music (id | title | mood | bpm | energy):`,
      ...(music.length
        ? music.map((m) => `${m.id} | ${m.title} | ${m.moodTags.join(", ") || "?"} | ${m.bpm ?? "?"} | ${m.energy ?? "?"}`)
        : ["(none)"]),
      `Sound effects (id | title | description):`,
      ...(effects.length ? effects.map((e) => `${e.id} | ${e.title} | ${e.description ?? e.moodTags.join(", ")}`) : ["(none)"]),
      ``,
      `- "musicId": the track whose mood, tempo and energy best match the reference feel, or "" if none fits or there's no music.${avoidMusic.length ? ` Recently used, prefer others: ${avoidMusic.join(", ")}.` : ""}`,
      `- "sfx": up to ${MAX_SFX} effects that support the voiceover, e.g. a whoosh into the hook, a pop on a reveal, a riser before the payoff. Each has "soundId", "sentence" (index) and "at" ("start" or "end" of that sentence). Fewer beats cluttered; [] if there are no effects.`,
    ].join("\n"),
    media: reference ? [reference] : [],
    schema: {
      type: "object",
      properties: {
        reference: {
          type: "object",
          properties: {
            genre: { type: "string" },
            mood: { type: "array", items: { type: "string" } },
            bpm: { type: "integer" },
            energy: { type: "string", enum: ["low", "medium", "high"] },
            notes: { type: "string" },
          },
          required: ["genre", "mood", "bpm", "energy", "notes"],
        },
        musicId: { type: "string" },
        sfx: {
          type: "array",
          items: {
            type: "object",
            properties: {
              soundId: { type: "string" },
              sentence: { type: "integer" },
              at: { type: "string", enum: ["start", "end"] },
            },
            required: ["soundId", "sentence", "at"],
          },
        },
      },
      required: ["reference", "musicId", "sfx"],
    },
  });

  const chosenMusic = music.find((m) => m.id === result.musicId) ?? null;
  const seen = new Set<string>();
  const chosenSfx: AudioBlueprint["sfx"] = [];
  for (const pick of result.sfx ?? []) {
    const sound = effects.find((e) => e.id === pick.soundId);
    const span = timing.spans[pick.sentence];
    const key = `${pick.sentence}:${pick.at}`;
    if (!sound || !span || seen.has(key) || chosenSfx.length >= MAX_SFX) continue;
    seen.add(key);
    const atSec = pick.at === "start" ? Math.max(0, span.start - SFX_LEAD_SEC) : span.end;
    chosenSfx.push({ id: sound.id, title: sound.title, sentence: pick.sentence, at: pick.at, atSec });
  }

  const voiceFile = await stageStoredFile(project.voiceFileId, workDir, "voice.wav");
  const musicFile = chosenMusic ? await stageStoredFile(chosenMusic.storageFileId, workDir, "music.m4a") : null;
  const sfxFiles = new Map<string, string>();
  for (const sfx of chosenSfx) {
    if (sfxFiles.has(sfx.id)) continue;
    const sound = effects.find((e) => e.id === sfx.id)!;
    sfxFiles.set(sfx.id, await stageStoredFile(sound.storageFileId, workDir, `sfx-${sfxFiles.size}.m4a`));
  }

  const { args, durationSec } = buildMixArgs({
    voiceFile,
    voiceDurationSec: timing.durationSec,
    music: musicFile ? { file: musicFile, startSec: 0 } : undefined,
    sfx: chosenSfx.map((s) => ({ file: sfxFiles.get(s.id)!, atSec: s.atSec })),
    outFile: "mix.m4a",
  });
  await runFfmpeg(args, { cwd: workDir, timeoutMs: 90_000 });

  const stored = await uploadBuffer({
    buffer: await readFile(path.join(workDir, "mix.m4a")),
    fileName: "mix.m4a",
    folder: `reels/${project.id}`,
    contentType: "audio/mp4",
    owner: { userId: project.userId, kind: "REEL", label: `Reel "${idea.title}": mixed audio` },
  });
  if (!stored) throw new Error("Couldn't store the mixed audio. Is storage configured?");

  const blueprint: AudioBlueprint = {
    reference: {
      basis: reference ? "listened" : "inferred",
      genre: result.reference?.genre ?? "",
      mood: result.reference?.mood ?? [],
      bpm: result.reference?.bpm ? result.reference.bpm : null,
      energy: result.reference?.energy ?? "medium",
      notes: result.reference?.notes ?? "",
    },
    music: chosenMusic ? { id: chosenMusic.id, title: chosenMusic.title, startSec: 0, bpm: chosenMusic.bpm } : null,
    sfx: chosenSfx,
    durationSec,
  };
  return { audioBlueprint: blueprint as object, mixUrl: stored.url, mixFileId: stored.fileId };
}
