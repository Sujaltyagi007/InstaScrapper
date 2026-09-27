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

export interface RenderPlan {
  clips: { file: string; durationSec: number }[];
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
  const inputs: string[] = [];
  const filters: string[] = [];

  plan.segments.forEach((seg, i) => {
    const length = seg.end - seg.start;
    const clip = plan.clips[i];
    // Skip the first half second when there's room: stock clips often open on a slow fade.
    const offset = clip.durationSec >= length + 1.5 ? 0.5 : 0;
    // Loop short clips so a long sentence never runs out of picture.
    inputs.push("-ss", num(offset), "-stream_loop", "-1", "-t", num(length + 0.5), "-i", clip.file);
    filters.push(
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,` +
        `trim=duration=${num(length)},setpts=PTS-STARTPTS[v${i}]`,
    );
  });
  const audioIndex = plan.segments.length;
  inputs.push("-i", plan.audioFile);
  filters.push(`${plan.segments.map((_, i) => `[v${i}]`).join("")}concat=n=${plan.segments.length}:v=1:a=0[vc]`);
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
