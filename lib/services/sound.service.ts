import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-helpers";
import { generateJson, isGeminiConfigured } from "@/lib/ai/gemini";
import { runFfmpeg } from "@/lib/render/ffmpeg";
import { parseDurationSec } from "@/lib/render/mix";
import { FetchLimitError, fetchPublicBytes, UnsafeUrlError } from "@/lib/security/fetch-public";
import { deleteStoredObject, uploadBuffer } from "@/lib/storage";

export type SoundKind = "MUSIC" | "SFX";

const MAX_SOUNDS_PER_USER = 200;
export const MAX_SOUND_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_SECONDS: Record<SoundKind, number> = { MUSIC: 300, SFX: 12 };

export async function listSounds(userId: string) {
  return prisma.soundAsset.findMany({ where: { userId }, orderBy: [{ kind: "asc" }, { createdAt: "desc" }] });
}

interface SoundTags {
  title: string;
  moodTags: string[];
  bpm: number;
  energy: "low" | "medium" | "high";
  description: string;
}

/** Gemini listens to an excerpt and tags it, so the audio stage can match sounds to a mood. */
async function tagSound(kind: SoundKind, excerpt: Buffer, fileTitle: string): Promise<SoundTags | null> {
  if (!isGeminiConfigured()) return null;
  try {
    return await generateJson<SoundTags>({
      prompt:
        kind === "MUSIC"
          ? `Tag this music track (file name "${fileTitle}") for a reel sound library. "title": a short readable title (keep the file's title if it's meaningful). "moodTags": 3-6 mood/genre words (e.g. "uplifting", "lofi", "cinematic", "tense"). "bpm": tempo, 0 if no clear beat. "energy": low, medium or high. "description": one short sentence on what kind of video it suits.`
          : `Tag this sound effect (file name "${fileTitle}") for a reel sound library. "title": a short name like "Whoosh", "Pop", "Riser", "Ding", "Impact". "moodTags": 1-4 words. "bpm": 0. "energy": low, medium or high. "description": what it sounds like and where it fits in an edit (e.g. "fast whoosh for a transition").`,
      media: [{ kind: "audio", mimeType: "audio/mp3", data: excerpt }],
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          moodTags: { type: "array", items: { type: "string" } },
          bpm: { type: "integer" },
          energy: { type: "string", enum: ["low", "medium", "high"] },
          description: { type: "string" },
        },
        required: ["title", "moodTags", "bpm", "energy", "description"],
      },
    });
  } catch (err) {
    // Tags help matching but aren't required; the sound is still usable.
    console.warn("[sounds] tagging failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function downloadSoundUrl(url: string): Promise<Buffer> {
  try {
    const { bytes } = await fetchPublicBytes(url, { maxBytes: MAX_SOUND_DOWNLOAD_BYTES, timeoutMs: 30_000 });
    return bytes;
  } catch (err) {
    if (err instanceof UnsafeUrlError || err instanceof FetchLimitError) throw new ApiError(400, err.message);
    throw new ApiError(400, "Couldn't download that link.");
  }
}

export async function importSound(
  userId: string,
  input: { kind: SoundKind; bytes: Buffer; fileName: string; title?: string; licenseUrl?: string; source?: string },
) {
  const count = await prisma.soundAsset.count({ where: { userId } });
  if (count >= MAX_SOUNDS_PER_USER) throw new ApiError(409, `The sound bank is full (${MAX_SOUNDS_PER_USER} sounds).`);

  const workDir = await mkdtemp(path.join(os.tmpdir(), "sound-"));
  try {
    await writeFile(path.join(workDir, "input"), input.bytes);
    const maxSec = MAX_SECONDS[input.kind];

    // One consistent format for the mixer: AAC 48 kHz stereo, metadata stripped.
    let log: string;
    try {
      ({ stderr: log } = await runFfmpeg(
        ["-i", "input", "-vn", "-map_metadata", "-1", "-t", String(maxSec), "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "sound.m4a"],
        { cwd: workDir, timeoutMs: 60_000 },
      ));
    } catch {
      throw new ApiError(400, "That isn't a playable audio file. For Pixabay, use the file's direct download link or upload the file.");
    }
    const sourceSec = parseDurationSec(log) ?? maxSec;
    const durationSec = Math.min(sourceSec, maxSec);

    // Gemini hears a short mono excerpt from past the intro, not the whole file.
    const excerptStart = input.kind === "MUSIC" ? Math.min(20, durationSec * 0.2) : 0;
    await runFfmpeg(
      ["-ss", excerptStart.toFixed(1), "-i", "sound.m4a", "-t", "40", "-ac", "1", "-ar", "16000", "-b:a", "48k", "excerpt.mp3"],
      { cwd: workDir, timeoutMs: 30_000 },
    );

    const fileTitle = input.fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 100) || "Untitled";
    const tags = await tagSound(input.kind, await readFile(path.join(workDir, "excerpt.mp3")), fileTitle);

    const stored = await uploadBuffer({
      buffer: await readFile(path.join(workDir, "sound.m4a")),
      fileName: `${input.kind.toLowerCase()}.m4a`,
      folder: `sounds/${userId}`,
      contentType: "audio/mp4",
      owner: {
        userId,
        kind: "SOUND",
        label: `${input.kind === "MUSIC" ? "Music" : "Sound effect"}: ${input.title?.trim() || fileTitle}`,
      },
    });
    if (!stored) throw new ApiError(503, "Couldn't store the sound. Is storage configured?");

    const sound = await prisma.soundAsset.create({
      data: {
        userId,
        kind: input.kind,
        title: (input.title?.trim() || tags?.title?.trim() || fileTitle).slice(0, 120),
        source: input.source ?? null,
        licenseUrl: input.licenseUrl?.trim() || null,
        moodTags: (tags?.moodTags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8),
        bpm: tags?.bpm ? Math.round(tags.bpm) : null,
        energy: tags?.energy ?? null,
        description: tags?.description?.trim() || null,
        durationMs: Math.round(durationSec * 1000),
        storageUrl: stored.url,
        storageFileId: stored.fileId,
      },
    });
    return { sound, tagged: tags !== null, trimmed: sourceSec > maxSec };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function deleteSound(userId: string, id: string): Promise<void> {
  const sound = await prisma.soundAsset.findFirst({ where: { id, userId } });
  if (!sound) throw new ApiError(404, "Sound not found.");
  if (!(await deleteStoredObject(sound.storageFileId))) {
    throw new ApiError(502, "Couldn't delete the file from storage. Try again.");
  }
  await prisma.soundAsset.delete({ where: { id } });
}
