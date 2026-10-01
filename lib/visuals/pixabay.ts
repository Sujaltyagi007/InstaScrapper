/**
 * Pixabay videos: free key (PIXABAY_API_KEY), no credit required. Its terms
 * ask for results to be cached for 24 hours (see search.ts) and forbid bulk
 * automated queries. Most clips are landscape, so the file picker prefers an
 * HD rendition that's cropped to the middle.
 */
import { getJson, isConfigured, pickReelFile, type StockClip } from "./types";

interface PixabayFile {
  url?: string;
  width?: number;
  height?: number;
  size?: number;
  thumbnail?: string;
}

interface PixabayHit {
  id: number;
  pageURL: string;
  tags?: string;
  duration?: number;
  user?: string;
  videos?: Record<string, PixabayFile>;
}

export function isPixabayConfigured(): boolean {
  return isConfigured(process.env.PIXABAY_API_KEY);
}

export async function searchPixabayClips(query: string, limit = 5, apiKey?: string): Promise<StockClip[]> {
  const key = (apiKey ?? process.env.PIXABAY_API_KEY)?.trim();
  if (!key) throw new Error("PIXABAY_API_KEY is not set.");
  const params = new URLSearchParams({
    key,
    q: query.slice(0, 100),
    per_page: String(Math.min(Math.max(limit * 2, 3), 50)),
    safesearch: "true",
  });
  const body = await getJson<{ hits?: PixabayHit[] }>(`https://pixabay.com/api/videos/?${params}`);

  const clips: StockClip[] = [];
  for (const hit of body.hits ?? []) {
    const renditions = Object.values(hit.videos ?? {}).filter((v) => v.url && v.width && v.height);
    const file = pickReelFile(
      renditions.map((v) => ({ url: v.url!, width: v.width!, height: v.height!, bytes: v.size })),
    );
    if (!file) continue;
    const thumbnail =
      hit.videos?.medium?.thumbnail || hit.videos?.large?.thumbnail || hit.videos?.small?.thumbnail || renditions[0]?.thumbnail;
    clips.push({
      source: "pixabay",
      id: hit.id,
      url: file.url,
      width: file.width,
      height: file.height,
      durationSec: hit.duration ?? 10,
      pageUrl: hit.pageURL,
      author: hit.user ?? "",
      previewImages: thumbnail ? [thumbnail] : [],
      title: (hit.tags ?? "").replace(/,/g, " "),
      license: "Pixabay Content License",
    });
    if (clips.length >= limit) break;
  }
  return clips;
}
