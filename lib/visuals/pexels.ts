import { isConfigured, pickReelFile, type StockClip } from "./types";

const API = "https://api.pexels.com/videos/search";

interface PexelsVideoFile {
  link: string;
  width: number | null;
  height: number | null;
  file_type: string;
}

interface PexelsVideo {
  id: number;
  url: string;
  duration: number;
  user?: { name?: string };
  image?: string;
  video_pictures?: { picture: string; nr: number }[];
  video_files: PexelsVideoFile[];
}

/** Two frames (start and middle) at 480px wide, so a batch of clips fits in one Gemini request. */
function previewImages(video: PexelsVideo): string[] {
  const pictures = [...(video.video_pictures ?? [])].sort((a, b) => a.nr - b.nr).map((p) => p.picture);
  const picked = pictures.length >= 2 ? [pictures[0], pictures[Math.floor(pictures.length / 2)]] : pictures;
  const frames = picked.length ? picked : video.image ? [video.image] : [];
  return frames.map((url) => {
    try {
      const u = new URL(url);
      if (u.hostname.endsWith("pexels.com")) {
        u.searchParams.set("auto", "compress");
        u.searchParams.set("w", "480");
      }
      return u.toString();
    } catch {
      return url;
    }
  });
}

export function isPexelsConfigured(): boolean {
  return isConfigured(process.env.PEXELS_API_KEY);
}

/** Pexels page URLs carry a readable title: /video/woman-running-on-a-beach-1234567/. */
function titleFromUrl(pageUrl: string): string {
  const slug = pageUrl.split("/").filter(Boolean).pop() ?? "";
  return slug.replace(/-?\d+$/, "").replace(/-/g, " ");
}

export async function searchPexelsClips(
  query: string,
  limit = 5,
  orientation: "portrait" | "landscape" = "portrait",
): Promise<StockClip[]> {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) throw new Error("PEXELS_API_KEY is not set.");

  const size = orientation === "portrait" ? "large" : "medium";
  const url = `${API}?query=${encodeURIComponent(query)}&orientation=${orientation}&size=${size}&per_page=${Math.min(limit * 2, 40)}`;
  const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Pexels ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { videos?: PexelsVideo[] };

  const clips: StockClip[] = [];
  for (const video of body.videos ?? []) {
    const file = pickReelFile(
      video.video_files
        .filter((f) => f.file_type === "video/mp4" && f.width && f.height)
        .map((f) => ({ url: f.link, width: f.width!, height: f.height! })),
    );
    if (!file) continue;
    clips.push({
      source: "pexels",
      id: video.id,
      url: file.url,
      width: file.width,
      height: file.height,
      durationSec: video.duration,
      pageUrl: video.url,
      author: video.user?.name ?? "",
      previewImages: previewImages(video),
      title: titleFromUrl(video.url),
      license: "Pexels License",
    });
    if (clips.length >= limit) break;
  }
  return clips;
}

export function searchPortraitClips(query: string, limit = 5): Promise<StockClip[]> {
  return searchPexelsClips(query, limit, "portrait");
}

export interface StockPhoto {
  source: "pexels";
  id: number;
  /** Large portrait rendition (about 1200px tall or more). */
  url: string;
  pageUrl: string;
  author: string;
}

/** Portrait stock photos, e.g. a backdrop for an animated scene. */
export async function searchPortraitPhotos(query: string, limit = 5): Promise<StockPhoto[]> {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) throw new Error("PEXELS_API_KEY is not set.");
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=${Math.min(limit, 40)}`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as {
    photos?: { id: number; url: string; photographer?: string; src: { large2x?: string; portrait?: string; original: string } }[];
  };
  return (body.photos ?? []).map((p) => ({
    source: "pexels",
    id: p.id,
    url: p.src.large2x ?? p.src.portrait ?? p.src.original,
    pageUrl: p.url,
    author: p.photographer ?? "",
  }));
}
