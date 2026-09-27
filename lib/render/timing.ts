export interface Silence {
  start: number;
  end: number;
}

export interface Span {
  start: number;
  end: number;
}

export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

export function parseSilences(ffmpegLog: string): Silence[] {
  const silences: Silence[] = [];
  let pendingStart: number | null = null;
  for (const line of ffmpegLog.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) pendingStart = Math.max(0, Number(start[1]));
    const end = line.match(/silence_end:\s*([\d.]+)/);
    if (end && pendingStart !== null) {
      silences.push({ start: pendingStart, end: Number(end[1]) });
      pendingStart = null;
    }
  }
  // silencedetect never emits silence_end for silence that runs to the end of the file.
  if (pendingStart !== null) silences.push({ start: pendingStart, end: Number.POSITIVE_INFINITY });
  return silences;
}

/**
 * Splits a voiceover into one span per sentence. The script is spoken with a
 * deliberate pause between sentences, so the longest interior silences are the
 * sentence boundaries; shorter ones (commas, breaths) are ignored.
 */
export function sentenceSpans(silences: Silence[], totalDuration: number, sentenceCount: number): Span[] {
  if (sentenceCount <= 0) return [];
  const edge = 0.05;
  // silencedetect can split one pause into back-to-back pieces; merge them so
  // the pause is measured (and ends) where speech actually resumes.
  const clamped: Silence[] = [];
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    const end = Math.min(s.end, totalDuration);
    const last = clamped[clamped.length - 1];
    if (last && s.start - last.end <= edge) last.end = Math.max(last.end, end);
    else clamped.push({ start: s.start, end });
  }

  const leading = clamped.find((s) => s.start <= edge);
  const trailing = clamped.find((s) => s.end >= totalDuration - edge && s !== leading);
  const speechStart = leading ? leading.end : 0;
  const speechEnd = trailing ? trailing.start : totalDuration;

  const interior = clamped
    .filter((s) => s !== leading && s !== trailing && s.start > speechStart && s.end < speechEnd)
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, sentenceCount - 1)
    .sort((a, b) => a.start - b.start);

  const spans: Span[] = [];
  let cursor = speechStart;
  for (const gap of interior) {
    spans.push({ start: cursor, end: gap.start });
    cursor = gap.end;
  }
  spans.push({ start: cursor, end: speechEnd });

  // Fewer pauses than sentences were found: split the longest spans evenly so
  // every sentence still gets a (less precise) slot rather than being dropped.
  while (spans.length < sentenceCount) {
    let longest = 0;
    spans.forEach((s, i) => {
      if (s.end - s.start > spans[longest].end - spans[longest].start) longest = i;
    });
    const s = spans[longest];
    const mid = (s.start + s.end) / 2;
    spans.splice(longest, 1, { start: s.start, end: mid }, { start: mid, end: s.end });
  }
  return spans;
}

/**
 * Breaks each sentence into short on-screen chunks (reel-style captions), timing
 * each chunk within its sentence in proportion to its character length.
 */
export function captionCues(sentences: string[], spans: Span[], maxWords = 3): CaptionCue[] {
  const cues: CaptionCue[] = [];
  sentences.forEach((sentence, i) => {
    const span = spans[i];
    if (!span) return;
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    const chunks: string[] = [];
    for (let w = 0; w < words.length; w += maxWords) chunks.push(words.slice(w, w + maxWords).join(" "));
    const totalChars = chunks.reduce((n, c) => n + c.length, 0) || 1;
    let t = span.start;
    for (const chunk of chunks) {
      const end = t + ((span.end - span.start) * chunk.length) / totalChars;
      cues.push({ start: t, end, text: chunk });
      t = end;
    }
  });
  return cues;
}

/** Duration of a PCM WAV buffer, read from its fmt and data chunk headers. */
export function wavDurationSec(wav: Buffer): number {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file.");
  }
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") byteRate = wav.readUInt32LE(offset + 16);
    if (id === "data") {
      if (!byteRate) throw new Error("WAV data chunk before fmt chunk.");
      // Streamed WAVs may carry a placeholder size; fall back to the real length.
      const dataBytes = size === 0 || size === 0xffffffff ? wav.length - offset - 8 : Math.min(size, wav.length - offset - 8);
      return dataBytes / byteRate;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk.");
}

/**
 * Plans how to shorten the deliberate pauses between sentences. The voice is
 * generated with long pauses so silencedetect finds sentence boundaries
 * reliably; a reel wants snappy ~0.3s gaps. Returns the source segments to keep
 * (in order, to be concatenated) and each sentence's span in the result.
 */
export function tightenPauses(
  spans: Span[],
  totalDuration: number,
  padSec = 0.15,
): { segments: Span[]; spans: Span[]; durationSec: number } {
  const segments: Span[] = spans.map((s, i) => {
    const prev = spans[i - 1];
    const next = spans[i + 1];
    // Never pad into a neighbour: split a short gap at its midpoint instead.
    const start = Math.max(0, s.start - padSec, prev ? (prev.end + s.start) / 2 : 0);
    const end = Math.min(totalDuration, s.end + padSec, next ? (s.end + next.start) / 2 : totalDuration);
    return { start, end };
  });

  const tightened: Span[] = [];
  let cursor = 0;
  segments.forEach((seg, i) => {
    const offset = cursor - seg.start;
    tightened.push({ start: spans[i].start + offset, end: spans[i].end + offset });
    cursor += seg.end - seg.start;
  });
  return { segments, spans: tightened, durationSec: cursor };
}
