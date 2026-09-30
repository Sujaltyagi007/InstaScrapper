/**
 * Sound effects and ambience from Freesound, restricted to CC0 (public
 * domain) so they're safe in monetised reels with no credit needed.
 * Needs a free API key: FREESOUND_API_KEY.
 */
const API = "https://freesound.org/apiv2/search/text/";

export interface FreeSound {
  id: number;
  name: string;
  durationSec: number;
  /** High-quality MP3 preview; downloadable without OAuth. */
  previewUrl: string;
  pageUrl: string;
  author: string;
}

export function isFreesoundConfigured(): boolean {
  const key = process.env.FREESOUND_API_KEY?.trim() ?? "";
  return key.length > 0 && !key.startsWith("your_");
}

export async function searchCc0Sounds(
  query: string,
  opts: { minSec?: number; maxSec?: number; limit?: number } = {},
): Promise<FreeSound[]> {
  const key = process.env.FREESOUND_API_KEY?.trim();
  if (!key) throw new Error("FREESOUND_API_KEY is not set.");
  const filter = `license:"Creative Commons 0" duration:[${opts.minSec ?? 0.2} TO ${opts.maxSec ?? 30}]`;
  const params = new URLSearchParams({
    query,
    filter,
    sort: "score",
    page_size: String(Math.min(opts.limit ?? 5, 30)),
    fields: "id,name,duration,previews,url,username,license",
    token: key,
  });
  const res = await fetch(`${API}?${params}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Freesound ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as {
    results?: {
      id: number;
      name: string;
      duration: number;
      url: string;
      username: string;
      license: string;
      previews?: Record<string, string>;
    }[];
  };
  return (body.results ?? [])
    // Double-check the licence: the filter is the contract, this is the guard.
    .filter((r) => /publicdomain\/zero|Creative Commons 0/i.test(r.license) && r.previews?.["preview-hq-mp3"])
    .map((r) => ({
      id: r.id,
      name: r.name,
      durationSec: r.duration,
      previewUrl: r.previews!["preview-hq-mp3"],
      pageUrl: r.url,
      author: r.username,
    }));
}
