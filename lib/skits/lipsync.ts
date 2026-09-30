/**
 * Mouth shapes over time for a voice track. Uses Rhubarb Lip Sync when its
 * binary is available (RHUBARB_PATH), otherwise a loudness-based fallback that
 * needs nothing installed. Rhubarb reads the actual sounds (closed lips on
 * M/B/P, round lips on O/U); the fallback only knows how loud the voice is.
 */
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { Mouth } from "./types";

export interface MouthCue {
  start: number;
  end: number;
  mouth: Mouth;
}

export function rhubarbPath(): string | null {
  const configured = process.env.RHUBARB_PATH?.trim();
  return configured || null;
}

async function runRhubarb(binary: string, wavFile: string, outFile: string): Promise<void> {
  await access(binary);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["-r", "phonetic", "-f", "json", "-q", "-o", outFile, wavFile], {
      cwd: path.dirname(binary),
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (c: string) => (stderr = (stderr + c).slice(-2000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`rhubarb exited with ${code}: ${stderr}`));
    });
  });
}

/** 16-bit PCM samples of a WAV file, mixed down to mono, plus its sample rate. */
export function wavSamples(wav: Buffer): { samples: Float32Array; sampleRate: number } {
  let offset = 12;
  let channels = 1;
  let sampleRate = 24000;
  let bits = 16;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      channels = wav.readUInt16LE(offset + 10);
      sampleRate = wav.readUInt32LE(offset + 12);
      bits = wav.readUInt16LE(offset + 22);
    }
    if (id === "data") {
      if (bits !== 16) throw new Error(`Only 16-bit WAV is supported, got ${bits}-bit.`);
      const end = Math.min(wav.length, offset + 8 + size);
      const frames = Math.floor((end - offset - 8) / (2 * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += wav.readInt16LE(offset + 8 + (i * channels + c) * 2);
        samples[i] = sum / channels / 32768;
      }
      return { samples, sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("WAV file has no data chunk.");
}

/**
 * Loudness-based mouth shapes: quiet = closed, louder = wider. Adjacent
 * windows at the same level vary between two shapes so a held vowel doesn't
 * look frozen, and every shape is held for at least two frames so the mouth
 * doesn't flicker.
 */
export function amplitudeMouthCues(wav: Buffer, fps = 30): MouthCue[] {
  const { samples, sampleRate } = wavSamples(wav);
  const win = Math.max(1, Math.round(sampleRate / fps));
  const levels: number[] = [];
  for (let i = 0; i < samples.length; i += win) {
    let sum = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    levels.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  const sorted = [...levels].filter((l) => l > 0.005).sort((a, b) => a - b);
  const loud = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 0.1;
  const shapes: Mouth[] = levels.map((l, i) => {
    const r = l / (loud || 1);
    if (r < 0.08) return "X";
    if (r < 0.25) return i % 4 < 2 ? "B" : "A";
    if (r < 0.5) return i % 4 < 2 ? "C" : "E";
    if (r < 0.8) return i % 4 < 2 ? "C" : "H";
    return "D";
  });
  const cues: MouthCue[] = [];
  const frame = 1 / fps;
  for (let i = 0; i < shapes.length; i++) {
    const last = cues[cues.length - 1];
    if (last && (last.mouth === shapes[i] || last.end - last.start < 2 * frame - 1e-6)) last.end = (i + 1) * frame;
    else cues.push({ start: i * frame, end: (i + 1) * frame, mouth: shapes[i] });
  }
  return cues;
}

export async function mouthCues(wav: Buffer, wavFile: string, workDir: string): Promise<{ cues: MouthCue[]; engine: "rhubarb" | "amplitude" }> {
  const binary = rhubarbPath();
  if (binary) {
    const outFile = path.join(workDir, "mouth.json");
    try {
      await runRhubarb(binary, wavFile, outFile);
      const json = JSON.parse(await readFile(outFile, "utf8")) as { mouthCues: { start: number; end: number; value: string }[] };
      return {
        cues: json.mouthCues.map((c) => ({ start: c.start, end: c.end, mouth: (c.value as Mouth) ?? "X" })),
        engine: "rhubarb",
      };
    } catch (err) {
      console.warn("[skit] Rhubarb failed, using the loudness fallback:", (err as Error).message.slice(0, 200));
    }
  }
  return { cues: amplitudeMouthCues(wav), engine: "amplitude" };
}

/** The mouth shape at time t (cues are sorted and non-overlapping). */
export function mouthAt(cues: MouthCue[], t: number, hint = { i: 0 }): Mouth {
  let i = hint.i;
  if (i >= cues.length || (cues[i] && cues[i].start > t)) i = 0;
  while (i < cues.length && cues[i].end <= t) i++;
  hint.i = i;
  const cue = cues[i];
  return cue && cue.start <= t ? cue.mouth : "X";
}
