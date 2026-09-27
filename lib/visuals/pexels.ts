const API = "https://api.pexels.com/videos/search";

export interface StockClip {
  source: "pexels";
  id: number;
  url: string;
  width: number;
  height: number;
  durationSec: number;
  pageUrl: string;
  author: string;
  /** Still frames from across the clip (small JPEGs), for the visual safety check. */
  previewImages: string[];
}

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
  const key = process.env.PEXELS_API_KEY?.trim() ?? "";
  return key.length > 0 && !key.startsWith("your_");
}

/**
 * Picks the portrait MP4 closest to 1080x1920. Anything much bigger (4K) costs
 * decode time on a 1-vCPU function for no visible gain after Instagram's re-encode.
 */
function pickFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  const portrait = files.filter(
    (f) => f.file_type === "video/mp4" && f.width && f.height && f.height > f.width && f.height >= 1280,
  );
  if (portrait.length === 0) return null;
  return portrait.sort((a, b) => Math.abs(a.height! - 1920) - Math.abs(b.height! - 1920))[0];
}

export async function searchPortraitClips(query: string, limit = 5): Promise<StockClip[]> {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) throw new Error("PEXELS_API_KEY is not set.");

  const url = `${API}?query=${encodeURIComponent(query)}&orientation=portrait&size=large&per_page=${Math.min(limit * 2, 40)}`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { videos?: PexelsVideo[] };

  const clips: StockClip[] = [];
  for (const video of body.videos ?? []) {
    const file = pickFile(video.video_files);
    if (!file) continue;
    clips.push({
      source: "pexels",
      id: video.id,
      url: file.link,
      width: file.width!,
      height: file.height!,
      durationSec: video.duration,
      pageUrl: video.url,
      author: video.user?.name ?? "",
      previewImages: previewImages(video),
    });
    if (clips.length >= limit) break;
  }
  return clips;
}
