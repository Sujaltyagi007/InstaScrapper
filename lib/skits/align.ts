/**
 * Line timing for a two-voice dialogue. The audio alone doesn't say where a
 * line ends: lines hold pauses as long as the gaps between turns, the two
 * voices can share a pitch range, and the TTS ignores pause tags used as turn
 * markers in conversational mode (all measured). So Gemini listens to the take
 * and estimates when each line starts and ends, and every boundary is snapped
 * to the nearest real silence, which keeps cuts exact even when the estimate
 * is a little off. Each turn gap is then cut to the length the script asked
 * for, so comic timing is directed, not accidental.
 */
import { generateJson } from "@/lib/ai/gemini";
import { sentenceSpans, type Silence, type Span } from "@/lib/render/timing";
import { wavSamples } from "./lipsync";
import { spokenText, type PauseBefore } from "./types";

export const PAUSE_SEC: Record<PauseBefore, number> = {
  overlap: 0.06,
  quick: 0.2,
  normal: 0.38,
  beat: 0.8,
  long: 1.4,
};
const LEAD_IN_SEC = 0.2;
const FADE_SEC = 0.008;

function speechChunks(silences: Silence[], totalDuration: number): Span[] {
  const merged: Silence[] = [];
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    const end = Math.min(s.end, totalDuration);
    const last = merged[merged.length - 1];
    if (last && s.start - last.end <= 0.05) last.end = Math.max(last.end, end);
    else merged.push({ start: s.start, end });
  }
  const chunks: Span[] = [];
  let cursor = 0;
  for (const s of merged) {
    if (s.start - cursor > 0.05) chunks.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (totalDuration - cursor > 0.05) chunks.push({ start: cursor, end: totalDuration });
  return chunks;
}

/**
 * Snaps estimated line boundaries to real silences: lines are made of whole
 * speech chunks, and the split between line k and k+1 is the gap closest to
 * the estimate (in order, each line at least one chunk).
 */
export function snapToSilences(silences: Silence[], totalDuration: number, estimates: Span[]): Span[] {
  const n = estimates.length;
  const chunks = speechChunks(silences, totalDuration);
  if (chunks.length < n) return sentenceSpans(silences, totalDuration, n);
  if (n === 1) return [{ start: chunks[0].start, end: chunks[chunks.length - 1].end }];
  const target = estimates.slice(0, -1).map((e, k) => (e.end + estimates[k + 1].start) / 2);
  const s = chunks.length;
  // Distance from a target time to the gap before chunk b (0 when inside it).
  const gapCost = (k: number, b: number) => {
    const a = chunks[b - 1].end;
    const z = chunks[b].start;
    return target[k] < a ? a - target[k] : target[k] > z ? target[k] - z : 0;
  };
  // dp[k][b]: line k+1 starts at chunk b.
  const dp = Array.from({ length: n - 1 }, () => new Float64Array(s).fill(Infinity));
  const from = Array.from({ length: n - 1 }, () => new Int32Array(s).fill(-1));
  for (let b = 1; b <= s - (n - 1); b++) dp[0][b] = gapCost(0, b);
  for (let k = 1; k < n - 1; k++) {
    for (let b = k + 1; b <= s - (n - 1 - k); b++) {
      for (let p = k; p < b; p++) {
        const c = dp[k - 1][p] + gapCost(k, b);
        if (c < dp[k][b]) {
          dp[k][b] = c;
          from[k][b] = p;
        }
      }
    }
  }
  let b = n - 1;
  for (let x = n - 1; x < s; x++) if (dp[n - 2][x] < dp[n - 2][b]) b = x;
  const starts: number[] = [];
  for (let k = n - 2; k >= 0; k--) {
    starts.unshift(b);
    b = from[k][b];
  }
  starts.unshift(0);
  return starts.map((st, i) => ({
    start: chunks[st].start,
    end: chunks[i + 1 < starts.length ? starts[i + 1] - 1 : s - 1].end,
  }));
}

/** Gemini's estimate of when each line starts and ends in the take, or null if it can't say. */
export async function estimateLineTimes(
  audio: Buffer,
  mimeType: string,
  lines: { speaker: string; text: string }[],
): Promise<Span[] | null> {
  const result = await generateJson<{ lines: { index: number; start: number; end: number }[] }>({
    prompt: [
      `This recording is two people performing the dialogue below, in order. For each line, give the time in seconds (decimals) when its first word starts and its last word ends.`,
      ...lines.map((l, i) => `${i}. ${l.speaker}: ${spokenText(l.text)}`),
    ].join("\n"),
    media: [{ kind: "audio", data: audio, mimeType }],
    schema: {
      type: "object",
      properties: {
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: { index: { type: "integer" }, start: { type: "number" }, end: { type: "number" } },
            required: ["index", "start", "end"],
          },
        },
      },
      required: ["lines"],
    },
  });
  const byIndex = new Map(result.lines?.map((l) => [l.index, l]) ?? []);
  const spans: Span[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = byIndex.get(i);
    if (!l || !Number.isFinite(l.start) || !Number.isFinite(l.end)) return null;
    spans.push({ start: l.start, end: Math.max(l.start, l.end) });
  }
  return spans;
}

function toWav(samples: Float32Array, sampleRate: number): Buffer {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  return out;
}

/**
 * Rebuilds the take from each line's span (see snapToSilences), with
 * the scripted gap before every turn.
 * Returns the new mono WAV and each line's exact span in it.
 */
export function retimeDialogue(
  wav: Buffer,
  found: Span[],
  pauses: PauseBefore[],
): { wav: Buffer; spans: Span[]; durationSec: number } {
  const { samples, sampleRate } = wavSamples(wav);
  const fade = Math.round(FADE_SEC * sampleRate);
  const pieces: Float32Array[] = [];
  const spans: Span[] = [];
  let t = 0;

  const silence = (sec: number) => {
    pieces.push(new Float32Array(Math.round(sec * sampleRate)));
    t += Math.round(sec * sampleRate) / sampleRate;
  };
  silence(LEAD_IN_SEC);
  found.forEach((span, i) => {
    if (i > 0) silence(PAUSE_SEC[pauses[i]] ?? PAUSE_SEC.normal);
    const from = Math.max(0, Math.floor(span.start * sampleRate));
    const to = Math.min(samples.length, Math.ceil(span.end * sampleRate));
    const piece = samples.slice(from, to);
    // Tiny fades so a cut never clicks.
    for (let k = 0; k < Math.min(fade, piece.length); k++) {
      piece[k] *= k / fade;
      piece[piece.length - 1 - k] *= k / fade;
    }
    spans.push({ start: t, end: t + piece.length / sampleRate });
    pieces.push(piece);
    t += piece.length / sampleRate;
  });

  const all = new Float32Array(pieces.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of pieces) {
    all.set(p, o);
    o += p.length;
  }
  return { wav: toWav(all, sampleRate), spans, durationSec: all.length / sampleRate };
}
