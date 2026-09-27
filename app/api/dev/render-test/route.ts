import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { captionCues } from "@/lib/render/timing";
import { buildAssSubtitles } from "@/lib/render/captions";
import { jsonError, requireCronAuth } from "@/lib/api-helpers";
import { isStorageEnabled, uploadBuffer } from "@/lib/storage";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { isPexelsConfigured, searchPortraitClips } from "@/lib/visuals/pexels";
import { ffmpegPath, ffmpegVersion, runFfmpeg, stageFonts } from "@/lib/render/ffmpeg";

// Phase 0 spike: proves a full-HD reel renders inside one Vercel function.
export const maxDuration = 300;

const CLIP_SECONDS = 10;
const CLIP_COUNT = 3;
const QUERIES = ["city night", "ocean waves", "mountain sunrise"];
const SENTENCES = [
  "This reel was rendered on a server",
  "with captions timed to the voice",
  "in full HD at 1080 by 1920",
];

async function downloadTo(url: string, file: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  return buf.length;
}

export async function GET(req: Request) {
  const started = Date.now();
  const workDir = await mkdtemp(path.join(os.tmpdir(), "render-test-"));
  try {
    requireCronAuth(req);
    const timings: Record<string, number> = {};

    // Visual inputs: real stock footage when configured, generated test pattern otherwise.
    const inputArgs: string[] = [];
    let source: "pexels" | "synthetic" = "synthetic";
    const clipsUsed: { pageUrl: string; width: number; height: number }[] = [];
    if (isPexelsConfigured()) {
      source = "pexels";
      const t = Date.now();
      let downloaded = 0;
      for (let i = 0; i < CLIP_COUNT; i++) {
        const [clip] = await searchPortraitClips(QUERIES[i], 1);
        if (!clip) throw new Error(`No portrait clip found for "${QUERIES[i]}".`);
        downloaded += await downloadTo(clip.url, path.join(workDir, `clip${i}.mp4`));
        clipsUsed.push({ pageUrl: clip.pageUrl, width: clip.width, height: clip.height });
        inputArgs.push("-stream_loop", "-1", "-t", String(CLIP_SECONDS), "-i", `clip${i}.mp4`);
      }
      timings.downloadMs = Date.now() - t;
      timings.downloadedBytes = downloaded;
    } else {
      for (let i = 0; i < CLIP_COUNT; i++) {
        inputArgs.push("-f", "lavfi", "-t", String(CLIP_SECONDS), "-i", `testsrc2=s=1080x1920:r=30`);
      }
    }

    const total = CLIP_SECONDS * CLIP_COUNT;
    inputArgs.push("-f", "lavfi", "-t", String(total), "-i", "sine=frequency=220:sample_rate=48000");

    const fontsDir = await stageFonts(workDir);
    const spans = SENTENCES.map((_, i) => ({ start: i * CLIP_SECONDS + 0.5, end: (i + 1) * CLIP_SECONDS - 0.5 }));
    await writeFile(path.join(workDir, "captions.ass"), buildAssSubtitles(captionCues(SENTENCES, spans)));

    const scaled = Array.from({ length: CLIP_COUNT }, (_, i) =>
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,setpts=PTS-STARTPTS[v${i}]`,
    );
    const concatInputs = Array.from({ length: CLIP_COUNT }, (_, i) => `[v${i}]`).join("");
    const filter = [
      ...scaled,
      `${concatInputs}concat=n=${CLIP_COUNT}:v=1:a=0[vc]`,
      `[vc]ass=captions.ass:fontsdir=${fontsDir}[vout]`,
      `[${CLIP_COUNT}:a]volume=0.15[aout]`,
    ].join(";");

    const render = await runFfmpeg(
      [
        ...inputArgs,
        "-filter_complex", filter,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-maxrate", "8M", "-bufsize", "16M",
        "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart",
        "-t", String(total),
        "out.mp4",
      ],
      { cwd: workDir, timeoutMs: 270_000 },
    );
    timings.renderMs = render.ms;

    const outFile = path.join(workDir, "out.mp4");
    const outBytes = (await stat(outFile)).size;

    await runFfmpeg(["-ss", "15", "-i", "out.mp4", "-frames:v", "1", "-vf", "scale=360:-2", "preview.jpg"], {
      cwd: workDir,
      timeoutMs: 20_000,
    });
    const preview = await readFile(path.join(workDir, "preview.jpg"));

    let url: string | null = null;
    if (isStorageEnabled()) {
      const t = Date.now();
      const stored = await uploadBuffer({
        buffer: await readFile(outFile),
        fileName: `render-test-${Date.now()}.mp4`,
        folder: "dev",
        contentType: "video/mp4",
      });
      url = stored?.url ?? null;
      timings.uploadMs = Date.now() - t;
    }

    const lastProgress = render.stderr.match(/frame=\s*\d+[^\n\r]*/g)?.pop() ?? null;
    return NextResponse.json({
      ok: true,
      platform: `${process.platform}-${process.arch}`,
      cpus: os.cpus().length,
      ffmpeg: { path: ffmpegPath(), version: await ffmpegVersion() },
      source,
      clipsUsed,
      output: { seconds: total, bytes: outBytes, mbps: +((outBytes * 8) / total / 1e6).toFixed(2), url },
      timings: { ...timings, totalMs: Date.now() - started },
      ffmpegLastProgress: lastProgress,
      previewDataUrl: `data:image/jpeg;base64,${preview.toString("base64")}`,
    });
  } catch (err) {
    return jsonError(err);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
