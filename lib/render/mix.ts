/**
 * Builds the ffmpeg arguments that mix a reel's audio: the voice on top, music
 * ducked under speech, sound effects at set times, and the whole thing levelled
 * to Instagram-style loudness. Pure (no I/O) so it can be unit-tested; file
 * names are relative to the ffmpeg working directory.
 */
export interface MixPlan {
  voiceFile: string;
  voiceDurationSec: number;
  /** Silence kept after the last word, so the reel doesn't cut off mid-breath. */
  tailSec?: number;
  music?: { file: string; startSec: number; volume?: number };
  sfx: { file: string; atSec: number; volume?: number }[];
  outFile: string;
}

const FORMAT = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
const DEFAULT_TAIL_SEC = 1.2;
const DEFAULT_MUSIC_VOLUME = 0.3;
const DEFAULT_SFX_VOLUME = 0.5;
const MUSIC_FADE_OUT_SEC = 1.5;

const num = (n: number) => String(Math.round(n * 1000) / 1000);

export function buildMixArgs(plan: MixPlan): { args: string[]; durationSec: number } {
  const tail = plan.tailSec ?? DEFAULT_TAIL_SEC;
  const duration = plan.voiceDurationSec + tail;
  const inputs: string[] = ["-i", plan.voiceFile];
  const graph: string[] = [];
  const mixLabels: string[] = [];

  // Each stem is levelled first, so a loud music master can't bury the voice.
  graph.push(`[0:a]${FORMAT},loudnorm=I=-16:TP=-2,${FORMAT},apad=pad_dur=${num(tail)}[vp]`);

  if (plan.music) {
    // Loop the track in case it's shorter than the reel; seek skips a slow intro.
    inputs.push("-stream_loop", "-1", "-ss", num(Math.max(0, plan.music.startSec)), "-i", plan.music.file);
    const volume = plan.music.volume ?? DEFAULT_MUSIC_VOLUME;
    const fadeStart = Math.max(0, duration - MUSIC_FADE_OUT_SEC);
    graph.push("[vp]asplit=2[v][vsc]");
    graph.push(
      `[1:a]${FORMAT},atrim=0:${num(duration)},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-2,${FORMAT},` +
        `volume=${num(volume)},afade=t=in:st=0:d=0.5,afade=t=out:st=${num(fadeStart)}:d=${MUSIC_FADE_OUT_SEC}[mraw]`,
    );
    // Duck the music whenever the voice is speaking.
    graph.push("[mraw][vsc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[m]");
    mixLabels.push("[v]", "[m]");
  } else {
    graph.push("[vp]anull[v]");
    mixLabels.push("[v]");
  }

  plan.sfx.forEach((sfx, i) => {
    const inputIndex = inputs.filter((a) => a === "-i").length;
    inputs.push("-i", sfx.file);
    const delayMs = Math.max(0, Math.round(sfx.atSec * 1000));
    graph.push(`[${inputIndex}:a]${FORMAT},volume=${num(sfx.volume ?? DEFAULT_SFX_VOLUME)},adelay=${delayMs}:all=1[s${i}]`);
    mixLabels.push(`[s${i}]`);
  });

  // duration=first: the padded voice sets the length; normalize=0 keeps each
  // stem's level instead of dividing everything by the input count.
  graph.push(
    `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0:normalize=0,` +
      `loudnorm=I=-14:TP=-1.5:LRA=11,${FORMAT}[out]`,
  );

  return {
    durationSec: duration,
    args: [
      ...inputs,
      "-filter_complex",
      graph.join(";"),
      "-map",
      "[out]",
      "-t",
      num(duration),
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      plan.outFile,
    ],
  };
}

/** Reads the input duration ffmpeg prints ("Duration: 00:02:13.45"). */
export function parseDurationSec(ffmpegLog: string): number | null {
  const m = ffmpegLog.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
