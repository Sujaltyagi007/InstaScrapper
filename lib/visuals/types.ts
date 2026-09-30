/**
 * Footage sources for reels. Every source is free and only returns material
 * that's safe to use in a monetised reel with no mandatory credit: Pexels and
 * Pixabay (their own licences), NASA (public domain), and Wikimedia Commons,
 * Internet Archive and Europeana (filtered to CC0 / public domain only).
 */
export const CLIP_SOURCES = ["pexels", "pixabay", "nasa", "wikimedia", "archive", "europeana"] as const;
export type ClipSource = (typeof CLIP_SOURCES)[number];

export const SOURCE_LABELS: Record<ClipSource, string> = {
  pexels: "Pexels",
  pixabay: "Pixabay",
  nasa: "NASA",
  wikimedia: "Wikimedia Commons",
  archive: "Internet Archive",
  europeana: "Europeana",
};

export interface StockClip {
  source: ClipSource;
  /** Unique within its source. Older saved clips (Pexels) use numbers. */
  id: number | string;
  url: string;
  width: number;
  height: number;
  durationSec: number;
  pageUrl: string;
  author: string;
  /** Still frames from across the clip (small JPEGs), for the visual safety check. */
  previewImages: string[];
  /** Words describing the clip (title, tags), used to rank results before any AI check. */
  title?: string;
  license?: string;
}

/** Identifies a clip across sources; clips saved before sources existed are Pexels. */
export function clipKey(clip: { source?: ClipSource; id: number | string }): string {
  return `${clip.source ?? "pexels"}:${clip.id}`;
}

export interface FileOption {
  url: string;
  width: number;
  height: number;
  bytes?: number;
}

const MAX_CLIP_BYTES = 120 * 1024 * 1024;

/**
 * Picks the rendition to download. A portrait file near 1080x1920 is best;
 * otherwise a landscape file that's about 1440 tall (HD/2K) is cropped to the
 * middle. 4K is avoided: decoding it on a 1-vCPU function costs time for no
 * visible gain after Instagram's re-encode.
 */
export function pickReelFile(files: FileOption[]): FileOption | null {
  const ok = files.filter((f) => f.width > 0 && f.height > 0 && (!f.bytes || f.bytes <= MAX_CLIP_BYTES));
  const closest = (list: FileOption[], target: number) =>
    [...list].sort((a, b) => Math.abs(a.height - target) - Math.abs(b.height - target) || b.height - a.height)[0];

  const portrait = ok.filter((f) => f.height > f.width && f.height >= 1280);
  if (portrait.length) return closest(portrait, 1920);
  const hd = ok.filter((f) => f.height >= 1080 && f.height <= 2160);
  if (hd.length) return closest(hd, 1440);
  const sd = ok.filter((f) => f.height >= 720);
  return sd.length ? closest(sd, 1080) : null;
}

/**
 * How far into a clip to start, as a fraction of its length. Broadcast and
 * archival footage opens (and often closes) on title slates, logos and contact
 * details: a measured 30 s NASA clip showed a logo plus a press phone number
 * for well over 4 seconds. The real footage sits in the middle, so these
 * start there. Pexels and Pixabay clips are already trimmed and keep the
 * default start. Preview frames for the safety check come from this same part.
 */
export const START_FRACTION: Partial<Record<ClipSource, number>> = {
  nasa: 0.35,
  wikimedia: 0.3,
  archive: 0.25,
  europeana: 0.25,
};

/** Request headers a source needs when its files are downloaded. */
export function downloadHeaders(source: ClipSource): Record<string, string> | undefined {
  // Wikimedia's policy asks automated clients to identify themselves.
  return source === "wikimedia" ? { "User-Agent": WIKIMEDIA_USER_AGENT } : undefined;
}

export const WIKIMEDIA_USER_AGENT = "ReelEngine/1.0 (footage search for original reels)";

/** A fetch that gives up after `ms` and sends a JSON accept header. */
export async function getJson<T>(url: string, opts: { ms?: number; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...opts.headers },
    signal: AbortSignal.timeout(opts.ms ?? 15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as T;
}

export function isConfigured(value: string | undefined): boolean {
  const v = value?.trim() ?? "";
  return v.length > 0 && !v.startsWith("your_");
}

export function stripHtml(html: string | undefined, max = 240): string {
  return (html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
