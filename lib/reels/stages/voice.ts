import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ai } from "@/lib/ai/router";
import { GEMINI_DEFAULT_VOICE, GeminiError } from "@/lib/ai/gemini";
import { runFfmpeg } from "@/lib/render/ffmpeg";
import { parseSilences, sentenceSpans, tightenPauses, wavDurationSec } from "@/lib/render/timing";
import { uploadBuffer } from "@/lib/storage";
import type { ReelScript, VoiceTiming } from "@/lib/reels/types";
import type { StageContext, StageResult } from "./context";

const MAX_VOICE_SEC = 90;

async function speakWithFallback(script: ReelScript): Promise<Buffer> {
  // Long pauses make the sentence boundaries easy for silencedetect to find;
  // they're cut down to reel pacing afterwards.
  const text = script.sentences.map((s) => s.text).join(" <long pause> ");
  try {
    return (await ai.speak({ text, style: script.voiceStyle, voice: script.voice })).wav;
  } catch (err) {
    // A voice name the model doesn't know is a 400; the default voice is known good.
    if (err instanceof GeminiError && err.status === 400 && script.voice !== GEMINI_DEFAULT_VOICE) {
      return (await ai.speak({ text, style: script.voiceStyle, voice: GEMINI_DEFAULT_VOICE })).wav;
    }
    throw err;
  }
}

export async function runVoiceStage({ project, idea, workDir }: StageContext): Promise<StageResult> {
  const script = project.script as ReelScript | null;
  if (!script?.sentences?.length) throw new Error("The project has no script.");

  const wav = await speakWithFallback(script);
  await writeFile(path.join(workDir, "raw.wav"), wav);
  const rawDuration = wavDurationSec(wav);

  const detect = await runFfmpeg(["-i", "raw.wav", "-af", "silencedetect=noise=-35dB:d=0.3", "-f", "null", "-"], {
    cwd: workDir,
    timeoutMs: 30_000,
  });
  const spans = sentenceSpans(parseSilences(detect.stderr), rawDuration, script.sentences.length);
  const plan = tightenPauses(spans, rawDuration);
  if (plan.durationSec > MAX_VOICE_SEC) {
    throw new Error(`The voiceover is ${Math.round(plan.durationSec)}s; reels here are capped at ${MAX_VOICE_SEC}s.`);
  }

  const cuts = plan.segments.map(
    (s, i) => `[0:a]atrim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`,
  );
  const joined = plan.segments.map((_, i) => `[a${i}]`).join("");
  await runFfmpeg(
    [
      "-i",
      "raw.wav",
      "-filter_complex",
      `${cuts.join(";")};${joined}concat=n=${plan.segments.length}:v=0:a=1[out]`,
      "-map",
      "[out]",
      "-c:a",
      "pcm_s16le",
      "voice.wav",
    ],
    { cwd: workDir, timeoutMs: 30_000 },
  );

  const voice = await readFile(path.join(workDir, "voice.wav"));
  const stored = await uploadBuffer({
    buffer: voice,
    fileName: "voice.wav",
    folder: `reels/${project.id}`,
    contentType: "audio/wav",
    owner: { userId: project.userId, kind: "REEL", label: `Reel "${idea.title}": voiceover` },
  });
  if (!stored) throw new Error("Couldn't store the voiceover. Is storage configured?");

  const timing: VoiceTiming = { durationSec: wavDurationSec(voice), spans: plan.spans };
  return { voiceUrl: stored.url, voiceFileId: stored.fileId, voiceTiming: timing as object };
}
