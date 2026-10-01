import { runFfmpeg } from "@/lib/render/ffmpeg";

export interface RenderMeasurements {
  width: number;
  height: number;
  loudnessLufs: number;
  truePeakDb: number;
  blackSec: number;
  frozenSec: number;
}

const MEASURE_TIMEOUT_MS = 60_000;

export function parseLoudness(log: string): { loudnessLufs?: number; truePeakDb?: number } {
  const at = log.lastIndexOf("Summary:");
  const summary = at >= 0 ? log.slice(at) : log;
  const num = (re: RegExp) => {
    const m = summary.match(re);
    return m && Number.isFinite(Number(m[1])) ? Number(m[1]) : undefined;
  };
  return {
    loudnessLufs: num(/\bI:\s+(-?[\d.]+)\s+LUFS/),
    truePeakDb: num(/Peak:\s+(-?[\d.]+)\s+dBFS/),
  };
}

export function parseBlackSeconds(log: string): number {
  let total = 0;
  for (const m of log.matchAll(/black_duration:\s*([\d.]+)/g)) total += Number(m[1]);
  return total;
}

export function parseFrozenSeconds(log: string): number {
  let total = 0;
  for (const m of log.matchAll(/freeze_duration:\s*([\d.]+)/g)) total += Number(m[1]);
  return total;
}

export function parseSize(log: string): { width?: number; height?: number } {
  const m = log.match(/Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : {};
}

export async function measureRender(workDir: string, file: string): Promise<Partial<RenderMeasurements>> {
  const run = (args: string[]) => runFfmpeg(args, { cwd: workDir, timeoutMs: MEASURE_TIMEOUT_MS }).then((r) => r.stderr, () => null);

  const [audio, video, info] = await Promise.all([
    run(["-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]),
    run(["-nostats", "-i", file, "-an", "-vf", "blackdetect=d=0.1:pic_th=0.98,freezedetect=n=-60dB:d=0.5", "-f", "null", "-"]),
    run(["-i", file, "-t", "0.1", "-f", "null", "-"]),
  ]);

  const out: Partial<RenderMeasurements> = {};
  if (audio) Object.assign(out, parseLoudness(audio));
  if (video) {
    out.blackSec = parseBlackSeconds(video);
    out.frozenSec = parseFrozenSeconds(video);
  }
  if (info) Object.assign(out, parseSize(info));
  return out;
}
