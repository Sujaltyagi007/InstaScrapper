import { NextResponse } from "next/server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApiError, jsonError, requireCronAuth } from "@/lib/api-helpers";
import { GEMINI_TEXT_MODEL, GEMINI_TTS_MODEL, GeminiError, generateJson, isGeminiConfigured, speak } from "@/lib/ai/gemini";
import { runFfmpeg } from "@/lib/render/ffmpeg";
import { captionCues, parseSilences, sentenceSpans, wavDurationSec } from "@/lib/render/timing";

// Phase 0 spike: Gemini writes 3 sentences (JSON), voices them, and ffmpeg's
// silencedetect recovers per-sentence timing for captions.
export const maxDuration = 120;

export async function GET(req: Request) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "voice-test-"));
  try {
    requireCronAuth(req);
    if (!isGeminiConfigured()) throw new ApiError(400, "GEMINI_API_KEY is not set.");

    const { searchParams } = new URL(req.url);
    const topic = searchParams.get("topic") ?? "why the ocean is salty";
    const timings: Record<string, number> = {};

    let t = Date.now();
    const script = await generateJson<{ sentences: string[] }>({
      prompt: `Write exactly 3 short, punchy sentences (6-12 words each) for an Instagram reel voiceover about: ${topic}. No emojis, no hashtags.`,
      schema: {
        type: "object",
        properties: { sentences: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 } },
        required: ["sentences"],
      },
    });
    timings.scriptMs = Date.now() - t;
    const sentences = script.sentences.slice(0, 3);

    t = Date.now();
    const { wav, mimeType } = await speak({
      text: sentences.join(" <long pause> "),
      style: "energetic, clear, confident narrator",
    });
    timings.ttsMs = Date.now() - t;

    await writeFile(path.join(workDir, "voice.wav"), wav);
    const duration = wavDurationSec(wav);
    const detect = await runFfmpeg(["-i", "voice.wav", "-af", "silencedetect=noise=-35dB:d=0.3", "-f", "null", "-"], {
      cwd: workDir,
      timeoutMs: 30_000,
    });
    timings.silenceDetectMs = detect.ms;

    const silences = parseSilences(detect.stderr);
    const spans = sentenceSpans(silences, duration, sentences.length);
    const withAudio = searchParams.get("audio") === "1";

    return NextResponse.json({
      ok: true,
      models: { text: GEMINI_TEXT_MODEL, tts: GEMINI_TTS_MODEL },
      sentences,
      audio: { mimeType, bytes: wav.length, durationSec: +duration.toFixed(2) },
      silences,
      sentenceSpans: spans,
      cues: captionCues(sentences, spans),
      timings,
      audioDataUrl: withAudio ? `data:audio/wav;base64,${wav.toString("base64")}` : undefined,
    });
  } catch (err) {
    if (err instanceof GeminiError) {
      return NextResponse.json(
        { ok: false, error: err.message, quotaExceeded: err.quotaExceeded },
        { status: err.quotaExceeded ? 429 : 502 },
      );
    }
    return jsonError(err);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
