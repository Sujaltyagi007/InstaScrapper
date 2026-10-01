/**
 * Plans the final reel render: one stock clip per script sentence, cut at the
 * pause before each sentence (snapped to the music's beat when it's close), with
 * burned-in captions and the mixed audio. Pure, so it can be unit-tested; file
 * names are relative to the ffmpeg working directory.
 */
import type { Span } from "./timing";

export interface Segment {
  start: number;
  end: number;
}

const MIN_SEGMENT_SEC = 1;
const MAX_BEAT_SNAP_SEC = 0.3;

/**
 * One segment per sentence covering the whole reel. A cut sits in the middle of
 * the pause before a sentence; with `beatSec` it moves to the nearest beat if
 * that's close and stays within the pause, so the picture changes on the music.
 */
export function segmentsForSentences(spans: Span[], totalSec: number, beatSec?: number | null): Segment[] {
  if (spans.length === 0) return [{ start: 0, end: totalSec }];
  const cuts: number[] = [0];
  for (let i = 1; i < spans.length; i++) {
    const prevEnd = spans[i - 1].end;
    const nextStart = spans[i].start;
    let cut = (prevEnd + nextStart) / 2;
    if (beatSec && beatSec > 0) {
      const beat = Math.round(cut / beatSec) * beatSec;
      // Stay inside the pause (with a little slack), never deep into a word.
      if (Math.abs(beat - cut) <= MAX_BEAT_SNAP_SEC && beat >= prevEnd - 0.1 && beat <= nextStart + 0.1) cut = beat;
    }
    // Too-short segments flash by; keep the previous clip instead of cutting.
    if (cut - cuts[cuts.length - 1] < MIN_SEGMENT_SEC) cut = cuts[cuts.length - 1] + MIN_SEGMENT_SEC;
    cuts.push(Math.min(cut, totalSec - MIN_SEGMENT_SEC));
  }
  return cuts.map((start, i) => ({ start, end: i + 1 < cuts.length ? cuts[i + 1] : totalSec }));
}

/** One picture shot. A long sentence becomes several, all from that sentence's clip. */
export interface Shot extends Segment {
  /** Index of the segment (and clip) this shot belongs to. */
  segment: number;
  /** 0 for the first shot of a segment; later parts jump ahead in the clip and punch in. */
  part: number;
}

const MAX_SHOT_SEC = 3;

const HOOK_SHOT_SEC = 1.2;

/**
 * Splits any segment longer than ~3.4 s into equal shots of about 3 s or less, so
 * the picture changes every 1.5-3 s while the voice runs on across the cut. The
 * opening segment starts with a short ~1.2 s shot so the picture changes inside
 * the first second or so, when viewers decide whether to stay.
 */
export function splitIntoShots(segments: Segment[], maxShotSec = MAX_SHOT_SEC): Shot[] {
  const shots: Shot[] = [];
  segments.forEach((seg, segment) => {
    let from = seg.start;
    let part = 0;
    if (segment === 0 && seg.end - seg.start >= HOOK_SHOT_SEC + 1.5) {
      shots.push({ start: from, end: from + HOOK_SHOT_SEC, segment, part: part++ });
      from += HOOK_SHOT_SEC;
    }
    const length = seg.end - from;
    const parts = length > maxShotSec * 1.15 ? Math.ceil(length / maxShotSec) : 1;
    for (let i = 0; i < parts; i++) {
      shots.push({ start: from + (length * i) / parts, end: from + (length * (i + 1)) / parts, segment, part: part++ });
    }
  });
  return shots;
}

export interface RenderPlan {
  /** `startSec`: where to start inside the clip (archival clips often open on a title slate). */
  clips: { file: string; durationSec: number; startSec?: number }[];
  segments: Segment[];
  audioFile: string;
  assFile: string;
  fontsDir: string;
  outFile: string;
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);

export function buildReelRenderArgs(plan: RenderPlan): string[] {
  if (plan.clips.length !== plan.segments.length) throw new Error("Need one clip per segment.");
  const total = plan.segments[plan.segments.length - 1].end;
  const shots = splitIntoShots(plan.segments);
  const inputs: string[] = [];
  const filters: string[] = [];

  shots.forEach((shot, i) => {
    const length = shot.end - shot.start;
    const segLength = plan.segments[shot.segment].end - plan.segments[shot.segment].start;
    const clip = plan.clips[shot.segment];
    // Skip the first half second when there's room: stock clips often open on a slow fade.
    const base =
      clip.startSec === undefined
        ? clip.durationSec >= segLength + 1.5
          ? 0.5
          : 0
        : Math.max(0, Math.min(clip.startSec, clip.durationSec - segLength - 0.3));
    // Later parts jump ahead in the clip; a short clip stays put and relies on the punch-in.
    const ahead = base + (shot.start - plan.segments[shot.segment].start);
    const start = ahead <= clip.durationSec - length - 0.3 ? ahead : base;
    // Odd parts are a ~15% punch-in so a cut within the same clip reads as a new shot.
    const scale = shot.part % 2 === 1 ? "scale=1242:2208" : "scale=1080:1920";
    // Loop short clips so a long shot never runs out of picture.
    inputs.push("-ss", num(start), "-stream_loop", "-1", "-t", num(length + 0.5), "-i", clip.file);
    filters.push(
      `[${i}:v]${scale}:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,` +
        `trim=duration=${num(length)},setpts=PTS-STARTPTS[v${i}]`,
    );
  });
  const audioIndex = shots.length;
  inputs.push("-i", plan.audioFile);
  filters.push(`${shots.map((_, i) => `[v${i}]`).join("")}concat=n=${shots.length}:v=1:a=0[vc]`);
  filters.push(`[vc]ass=${plan.assFile}:fontsdir=${plan.fontsDir},format=yuv420p[vout]`);

  return [
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    `${audioIndex}:a`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-maxrate",
    "8M",
    "-bufsize",
    "16M",
    "-profile:v",
    "high",
    "-g",
    "60",
    "-keyint_min",
    "60",
    "-sc_threshold",
    "0",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    "-t",
    num(total),
    plan.outFile,
  ];
}
