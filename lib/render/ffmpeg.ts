import { spawn } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
// Listed in serverExternalPackages, so this runs as a real Node require and the
// package's own __dirname points at the actual binary on disk.
import ffmpegStatic from "ffmpeg-static";

export const FONT_DIR = path.join(process.cwd(), "lib", "render", "fonts");
export const CAPTION_FONT_FILE = "Anton-Regular.ttf";
export const CAPTION_FONT_NAME = "Anton";

export function ffmpegPath(): string {
  if (!ffmpegStatic) throw new Error("ffmpeg-static has no binary for this platform.");
  return ffmpegStatic;
}

export interface FfmpegResult {
  stderr: string;
  ms: number;
}

const STDERR_KEEP_BYTES = 64 * 1024;

export function runFfmpeg(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<FfmpegResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ["-hide_banner", "-nostdin", "-y", ...args], {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    const collect = (chunk: string) => {
      stderr += chunk;
      if (stderr.length > STDERR_KEEP_BYTES * 2) stderr = stderr.slice(-STDERR_KEEP_BYTES);
    };
    child.stdout.setEncoding("utf8").on("data", collect);
    child.stderr.setEncoding("utf8").on("data", collect);

    const timer = opts.timeoutMs
      ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs)
      : null;

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      const ms = Date.now() - started;
      if (code === 0) return resolve({ stderr, ms });
      const tail = stderr.slice(-2000);
      reject(new Error(`ffmpeg exited with ${signal ?? code} after ${ms}ms: ${tail}`));
    });
  });
}

/**
 * Copies the caption font into `workDir/fonts` so filters can reference it by a
 * relative path. Absolute Windows paths need awkward escaping inside ffmpeg
 * filter strings; running ffmpeg with cwd=workDir sidesteps that entirely.
 */
export async function stageFonts(workDir: string): Promise<string> {
  const dest = path.join(workDir, "fonts");
  await mkdir(dest, { recursive: true });
  await copyFile(path.join(FONT_DIR, CAPTION_FONT_FILE), path.join(dest, CAPTION_FONT_FILE));
  return "fonts";
}

export async function ffmpegVersion(): Promise<string> {
  const { stderr } = await runFfmpeg(["-version"]).catch((err: Error) => ({ stderr: err.message, ms: 0 }));
  return stderr.split("\n")[0]?.trim() ?? "unknown";
}
