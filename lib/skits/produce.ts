/**
 * Makes one finished skit video from a premise: scene -> two-voice
 * performance -> line timing -> lip sync -> backdrop -> ambience and sound
 * effects -> mix -> render. All free: Gemini free tier, Pexels, Freesound CC0.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { speakDialogue } from "@/lib/ai/gemini";
import { isFreesoundConfigured, searchCc0Sounds } from "@/lib/audio/freesound";
import { buildAssSubtitles } from "@/lib/render/captions";
import { runFfmpeg, stageFonts } from "@/lib/render/ffmpeg";
import { buildMixArgs } from "@/lib/render/mix";
import { captionCues, parseSilences, sentenceSpans, wavDurationSec, type Span } from "@/lib/render/timing";
import { fetchPublicToFile } from "@/lib/security/fetch-public";
import { isPexelsConfigured, searchPortraitPhotos } from "@/lib/visuals/pexels";
import { estimateLineTimes, retimeDialogue, snapToSilences } from "./align";
import { mouthCues } from "./lipsync";
import { renderSkitVideo } from "./render";
import { spokenText, type Skit } from "./types";
import { writeSkit } from "./writer";

export interface SkitResult {
  skit: Skit;
  outFile: string;
  durationSec: number;
  spans: Span[];
  lipSync: "rhubarb" | "amplitude";
  /** "gemini" = lines timed by ear and snapped to pauses; "pauses" = fallback. */
  timingSource: "gemini" | "pauses";
  credits: string[];
  timings: Record<string, number>;
}

const AMBIENCE_VOLUME = 0.12;
const SFX_VOLUME = 0.45;

async function timed<T>(timings: Record<string, number>, name: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  try {
    return await fn();
  } finally {
    timings[name] = Date.now() - t;
  }
}

export async function produceSkit(params: {
  workDir: string;
  premise?: string;
  skit?: Skit;
  niche?: string;
  outName?: string;
  /** Re-use an existing performance (re-renders) instead of a new TTS call. */
  voiceWav?: Buffer;
}): Promise<SkitResult> {
  const { workDir } = params;
  const timings: Record<string, number> = {};
  const credits: string[] = [];

  const skit =
    params.skit ??
    (await timed(timings, "script", () => writeSkit({ premise: params.premise ?? "a funny everyday situation", niche: params.niche })));

  // The raw take is saved so a re-render can re-use the performance without
  // another TTS request.
  const take = params.voiceWav
    ? params.voiceWav
    : (
        await timed(timings, "voice", () =>
          speakDialogue({
            turns: skit.lines.map((l) => ({ speaker: l.speaker, text: l.text, style: l.style })),
            speakers: skit.characters.map((c) => ({ speaker: c.name, voice: c.voice })),
          }),
        )
      ).wav;
  await writeFile(path.join(workDir, "take.wav"), take);

  const voiceFile = "dialogue.wav";
  let timingSource: SkitResult["timingSource"] = "gemini";
  const { wav, spans, durationSec: voiceSec } = await timed(timings, "timing", async () => {
    const takeSec = wavDurationSec(take);
    const { stderr } = await runFfmpeg(["-i", "take.wav", "-af", "silencedetect=noise=-35dB:d=0.2", "-f", "null", "-"], {
      cwd: workDir,
    });
    const silences = parseSilences(stderr);
    let found: Span[];
    try {
      // A small mono copy keeps the request light.
      await runFfmpeg(["-i", "take.wav", "-ac", "1", "-ar", "16000", "-b:a", "32k", "take.mp3"], { cwd: workDir });
      const estimate = await estimateLineTimes(await readFile(path.join(workDir, "take.mp3")), "audio/mpeg", skit.lines);
      if (!estimate) throw new Error("Gemini didn't time every line.");
      found = snapToSilences(silences, takeSec, estimate);
    } catch (err) {
      console.warn("[skit] line timing by ear failed, using the longest pauses:", (err as Error).message.slice(0, 200));
      timingSource = "pauses";
      found = sentenceSpans(silences, takeSec, skit.lines.length);
    }
    const retimed = retimeDialogue(take, found, skit.lines.map((l) => l.pauseBefore));
    await writeFile(path.join(workDir, voiceFile), retimed.wav);
    return retimed;
  });

  const lip = await timed(timings, "lipsync", () => mouthCues(wav, path.join(workDir, voiceFile), workDir));

  const backgroundFile = await timed(timings, "backdrop", async () => {
    if (!isPexelsConfigured()) return null;
    try {
      const [photo] = await searchPortraitPhotos(skit.location.photoQuery, 3);
      if (!photo) return null;
      const file = path.join(workDir, "backdrop.jpg");
      await fetchPublicToFile(photo.url, file, { maxBytes: 15 * 1024 * 1024, timeoutMs: 30_000 });
      credits.push(`Backdrop: photo by ${photo.author} on Pexels (${photo.pageUrl})`);
      return file;
    } catch (err) {
      console.warn("[skit] backdrop failed, using a plain gradient:", (err as Error).message.slice(0, 200));
      return null;
    }
  });

  const sounds = await timed(timings, "sounds", async () => {
    const out: { ambience: string | null; sfx: { file: string; atSec: number; volume: number }[] } = { ambience: null, sfx: [] };
    if (!isFreesoundConfigured()) return out;
    try {
      const [amb] = await searchCc0Sounds(skit.location.ambience, { minSec: 8, maxSec: 120, limit: 3 });
      if (amb) {
        out.ambience = "ambience.mp3";
        await fetchPublicToFile(amb.previewUrl, path.join(workDir, out.ambience), { maxBytes: 8 * 1024 * 1024, timeoutMs: 30_000 });
        credits.push(`Ambience: "${amb.name}" by ${amb.author} (CC0, ${amb.pageUrl})`);
      }
    } catch (err) {
      console.warn("[skit] ambience failed:", (err as Error).message.slice(0, 200));
    }
    for (const [i, line] of skit.lines.entries()) {
      if (!line.sfx) continue;
      try {
        const [s] = await searchCc0Sounds(line.sfx, { maxSec: 4, limit: 3 });
        if (!s) continue;
        const file = `sfx-${i}.mp3`;
        await fetchPublicToFile(s.previewUrl, path.join(workDir, file), { maxBytes: 4 * 1024 * 1024, timeoutMs: 20_000 });
        out.sfx.push({ file, atSec: Math.max(0, spans[i].start - 0.15), volume: SFX_VOLUME });
        credits.push(`SFX: "${s.name}" by ${s.author} (CC0, ${s.pageUrl})`);
      } catch (err) {
        console.warn(`[skit] sfx "${line.sfx}" failed:`, (err as Error).message.slice(0, 200));
      }
    }
    return out;
  });

  const mixFile = "mix.m4a";
  const mix = buildMixArgs({
    voiceFile,
    voiceDurationSec: voiceSec,
    music: sounds.ambience ? { file: sounds.ambience, startSec: 0, volume: AMBIENCE_VOLUME } : undefined,
    sfx: sounds.sfx,
    outFile: mixFile,
  });
  await timed(timings, "mix", () => runFfmpeg(mix.args, { cwd: workDir }));

  const assFile = "captions.ass";
  await writeFile(
    path.join(workDir, assFile),
    buildAssSubtitles(captionCues(skit.lines.map((l) => spokenText(l.text)), spans)),
  );
  const fontsDir = await stageFonts(workDir);

  const outFile = params.outName ?? "skit.mp4";
  await timed(timings, "render", () =>
    renderSkitVideo({
      skit,
      spans,
      mouth: lip.cues,
      totalSec: mix.durationSec,
      backgroundFile,
      audioFile: mixFile,
      assFile,
      fontsDir,
      workDir,
      outFile,
    }),
  );

  return {
    skit,
    outFile: path.join(workDir, outFile),
    durationSec: mix.durationSec,
    spans,
    lipSync: lip.engine,
    timingSource,
    credits,
    timings,
  };
}
