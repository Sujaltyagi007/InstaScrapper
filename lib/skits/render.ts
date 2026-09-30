/**
 * Renders a skit frame by frame: blurred location photo, both characters
 * (expression, lip sync, blinks, a little movement), a counter in front of
 * them, and a virtual camera that cuts between a two-shot and close-ups on
 * the line boundaries. Frames are piped straight into ffmpeg, which burns in
 * the captions and adds the mixed audio.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import sharp from "sharp";
import { ffmpegPath } from "@/lib/render/ffmpeg";
import type { Span } from "@/lib/render/timing";
import { CHARACTER_WIDTH, FACE_CENTER, characterSvg, type Pose } from "./character-svg";
import { mouthAt, type MouthCue } from "./lipsync";
import type { Expression, Mouth, Skit } from "./types";

const W = 1080;
const H = 1920;
/** Background and foreground are prepared at 2x so close-ups stay sharp. */
const BG_SCALE = 2;
/** Characters are drawn 1.3x their canvas size in the world. */
const CHAR_SCALE = 1.3;
const CHAR_WORLD_TOP = 280;
const CHAR_CENTERS = [290, 790];
const COUNTER_TOP = 1470;
const FACE_SCREEN_Y = 760;
const ZOOM = { "two-shot": 1, "speaker-close": 1.4, "listener-reaction": 1.55 } as const;
const PUNCH_ZOOM = 1.12;
const PUNCH_SEC = 0.4;

interface Camera {
  z: number;
  cx: number;
  cy: number;
}

interface Raster {
  data: Buffer;
  width: number;
  height: number;
}

export interface SkitRenderInput {
  skit: Skit;
  spans: Span[];
  mouth: MouthCue[];
  totalSec: number;
  /** Local path of the backdrop photo, or null for a plain gradient. */
  backgroundFile: string | null;
  /** Mixed audio (AAC), relative to workDir. */
  audioFile: string;
  /** ASS captions, relative to workDir. */
  assFile: string;
  fontsDir: string;
  workDir: string;
  outFile: string;
  fps?: number;
}

/** Copies an RGBA raster onto an RGB frame at (x, y), clipped to the frame. */
function blit(dst: Buffer, src: Raster, x: number, y: number) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + src.width);
  const y1 = Math.min(H, y + src.height);
  if (x0 >= x1 || y0 >= y1) return;
  const s = src.data;
  for (let row = y0; row < y1; row++) {
    let si = ((row - y) * src.width + (x0 - x)) * 4;
    let di = (row * W + x0) * 3;
    for (let col = x0; col < x1; col++, si += 4, di += 3) {
      const a = s[si + 3];
      if (a === 0) continue;
      if (a === 255) {
        dst[di] = s[si];
        dst[di + 1] = s[si + 1];
        dst[di + 2] = s[si + 2];
      } else {
        const ia = 255 - a;
        dst[di] = (s[si] * a + dst[di] * ia + 127) / 255;
        dst[di + 1] = (s[si + 1] * a + dst[di + 1] * ia + 127) / 255;
        dst[di + 2] = (s[si + 2] * a + dst[di + 2] * ia + 127) / 255;
      }
    }
  }
}

function clampCamera(cam: Camera): Camera {
  const hw = W / 2 / cam.z;
  const hh = H / 2 / cam.z;
  return { z: cam.z, cx: Math.min(W - hw, Math.max(hw, cam.cx)), cy: Math.min(H - hh, Math.max(hh, cam.cy)) };
}

function faceWorld(index: number) {
  return { x: CHAR_CENTERS[index], y: CHAR_WORLD_TOP + FACE_CENTER.y * CHAR_SCALE };
}

function counterSvg(): string {
  const w = W * BG_SCALE;
  const h = H * BG_SCALE;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}">` +
    `<defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b98a5e"/><stop offset="1" stop-color="#7a5236"/></linearGradient></defs>` +
    `<rect x="0" y="${COUNTER_TOP - 18}" width="${W}" height="40" fill="#000" opacity="0.18"/>` +
    `<rect x="-10" y="${COUNTER_TOP}" width="${W + 20}" height="${H - COUNTER_TOP + 10}" fill="url(#c)" stroke="#2a2233" stroke-width="6"/>` +
    `<rect x="-10" y="${COUNTER_TOP}" width="${W + 20}" height="34" fill="#d9ad7c" stroke="#2a2233" stroke-width="6"/>` +
    `<g transform="translate(860 ${COUNTER_TOP - 118})"><rect x="0" y="0" width="92" height="118" rx="14" fill="#f4f1ea" stroke="#2a2233" stroke-width="6"/>` +
    `<path d="M92 30 Q140 32 138 62 Q136 92 92 90" fill="none" stroke="#2a2233" stroke-width="10"/><rect x="0" y="36" width="92" height="22" fill="#e4572e"/></g>` +
    `</svg>`
  );
}

async function prepareLayers(backgroundFile: string | null) {
  const bw = W * BG_SCALE;
  const bh = H * BG_SCALE;
  const bgImage = backgroundFile
    ? sharp(backgroundFile).resize(bw, bh, { fit: "cover" }).blur(4).modulate({ brightness: 0.82, saturation: 0.9 })
    : sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fc5e8"/><stop offset="1" stop-color="#f6d7b0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
        ),
      );
  const bg = await bgImage.removeAlpha().raw().toBuffer();
  const fg = await sharp(Buffer.from(counterSvg())).ensureAlpha().raw().toBuffer();
  return { bg, fg, bw, bh };
}

export async function renderSkitVideo(input: SkitRenderInput): Promise<{ frames: number; ms: number }> {
  const started = Date.now();
  const fps = input.fps ?? 30;
  const { skit, spans } = input;
  const layers = await prepareLayers(input.backgroundFile);

  // Cuts sit in the middle of the pause before each line.
  const cuts = spans.map((s, i) => (i === 0 ? 0 : (spans[i - 1].end + s.start) / 2));
  const lineAt = (t: number) => {
    let i = 0;
    while (i + 1 < cuts.length && cuts[i + 1] <= t) i++;
    return i;
  };
  const speakerIndex = (i: number) => (skit.lines[i].speaker === skit.characters[0].name ? 0 : 1);

  const cameraFor = (i: number, t: number): Camera => {
    const line = skit.lines[i];
    const sp = speakerIndex(i);
    const focus = line.shot === "listener-reaction" ? 1 - sp : sp;
    let z: number = ZOOM[line.shot];
    if (line.beat === "punchline") {
      const p = Math.min(1, Math.max(0, (t - spans[i].start) / PUNCH_SEC));
      // Ease out, and snap to a few steps so rasters can be cached.
      z *= 1 + (PUNCH_ZOOM - 1) * Math.round((1 - (1 - p) * (1 - p)) * 4) / 4;
    }
    if (line.shot === "two-shot") return clampCamera({ z, cx: W / 2, cy: H / 2 - (z - 1) * 300 });
    const face = faceWorld(focus);
    return clampCamera({ z, cx: face.x, cy: face.y - (FACE_SCREEN_Y - H / 2) / z });
  };

  const bgCache = new Map<string, Buffer>();
  const fgCache = new Map<string, Raster>();
  const cameraKey = (c: Camera) => `${c.z.toFixed(3)}:${Math.round(c.cx)}:${Math.round(c.cy)}`;
  async function cameraLayers(cam: Camera) {
    const key = cameraKey(cam);
    let bg = bgCache.get(key);
    let fg = fgCache.get(key);
    if (!bg || !fg) {
      const region = {
        left: Math.max(0, Math.round((cam.cx - W / 2 / cam.z) * BG_SCALE)),
        top: Math.max(0, Math.round((cam.cy - H / 2 / cam.z) * BG_SCALE)),
        width: Math.round((W / cam.z) * BG_SCALE),
        height: Math.round((H / cam.z) * BG_SCALE),
      };
      region.width = Math.min(region.width, layers.bw - region.left);
      region.height = Math.min(region.height, layers.bh - region.top);
      bg = await sharp(layers.bg, { raw: { width: layers.bw, height: layers.bh, channels: 3 } })
        .extract(region).resize(W, H, { fit: "fill" }).raw().toBuffer();
      const fgData = await sharp(layers.fg, { raw: { width: layers.bw, height: layers.bh, channels: 4 } })
        .extract(region).resize(W, H, { fit: "fill" }).raw().toBuffer();
      fg = { data: fgData, width: W, height: H };
      bgCache.set(key, bg);
      fgCache.set(key, fg);
    }
    return { bg, fg };
  }

  const charCache = new Map<string, Raster>();
  async function characterRaster(index: number, pose: Pose, z: number): Promise<Raster> {
    const key = `${index}:${pose.expression}:${pose.mouth}:${pose.blink}:${z.toFixed(3)}`;
    let r = charCache.get(key);
    if (!r) {
      const svg = characterSvg(skit.characters[index].look, pose, z * CHAR_SCALE);
      const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      r = { data, width: info.width, height: info.height };
      charCache.set(key, r);
    }
    return r;
  }

  // Blinks: each character on their own irregular schedule (deterministic per character).
  const blinks = skit.characters.map((_, ci) => {
    const times: number[] = [];
    let t = 0.8 + ci * 1.3;
    let seed = 7 + ci * 13;
    while (t < input.totalSec) {
      times.push(t);
      seed = (seed * 9301 + 49297) % 233280;
      t += 2.2 + (seed / 233280) * 3;
    }
    return times;
  });
  const isBlinking = (ci: number, t: number) => blinks[ci].some((b) => t >= b && t < b + 0.13);

  const frames = Math.ceil(input.totalSec * fps);
  const ff = spawn(
    ffmpegPath(),
    [
      "-hide_banner", "-y",
      "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-r", String(fps), "-i", "pipe:0",
      "-i", input.audioFile,
      "-vf", `ass=${input.assFile}:fontsdir=${input.fontsDir},format=yuv420p`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high",
      "-c:a", "copy", "-shortest", "-movflags", "+faststart",
      input.outFile,
    ],
    { cwd: input.workDir, stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  ff.stderr.setEncoding("utf8").on("data", (c: string) => (stderr = (stderr + c).slice(-4000)));
  const closed = new Promise<number | null>((resolve, reject) => {
    ff.on("error", reject);
    ff.on("close", resolve);
  });

  const hints = [{ i: 0 }];
  try {
    for (let f = 0; f < frames; f++) {
      const t = f / fps;
      const i = lineAt(t);
      const line = skit.lines[i];
      const sp = speakerIndex(i);
      const cam = cameraFor(i, t);
      const { bg, fg } = await cameraLayers(cam);
      const frame = Buffer.allocUnsafe(W * H * 3);
      bg.copy(frame);

      const speaking = t >= spans[i].start - 0.05 && t <= spans[i].end + 0.05;
      const mouth: Mouth = speaking ? mouthAt(input.mouth, t, hints[0]) : "X";
      // Listener first, speaker drawn on top.
      for (const ci of [1 - sp, sp]) {
        const isSpeaker = ci === sp;
        const expression: Expression = isSpeaker ? line.expression : line.listenerExpression;
        const pose: Pose = {
          expression,
          mouth: isSpeaker ? mouth : "X",
          blink: isBlinking(ci, t),
          look: ci === 0 ? 0.6 : -0.6,
        };
        const raster = await characterRaster(ci, pose, cam.z);
        const phase = t + ci * 0.7;
        const bob = isSpeaker && speaking
          ? -Math.abs(Math.sin(phase * 7)) * 7
          : expression === "laugh"
            ? -Math.abs(Math.sin(phase * 14)) * 9
            : Math.sin(phase * 1.9) * 3;
        const worldLeft = CHAR_CENTERS[ci] - (CHARACTER_WIDTH * CHAR_SCALE) / 2;
        const sx = Math.round((worldLeft - cam.cx) * cam.z + W / 2);
        const sy = Math.round((CHAR_WORLD_TOP + bob - cam.cy) * cam.z + H / 2);
        blit(frame, raster, sx, sy);
      }
      blit(frame, fg, 0, 0);

      if (!ff.stdin.write(frame)) await once(ff.stdin, "drain");
    }
  } finally {
    ff.stdin.end();
  }
  const code = await closed;
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}: ${stderr.slice(-1500)}`);
  return { frames, ms: Date.now() - started };
}

