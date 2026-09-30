/**
 * NASA Image and Video Library: no key, public domain. NASA asks to be
 * acknowledged as the source and that footage isn't used to imply endorsement.
 * Search returns a manifest per video; the MP4 renditions are in it.
 */
import { getJson, stripHtml, type StockClip } from "./types";

interface NasaItem {
  href: string;
  data: { nasa_id: string; title?: string; description?: string; keywords?: string[]; center?: string }[];
}

const https = (url: string) => url.replace(/^http:/, "https:");

async function toClip(item: NasaItem): Promise<StockClip | null> {
  const meta = item.data[0];
  if (!meta) return null;
  const manifest = await getJson<string[] | { href: string }[]>(https(item.href), { ms: 12_000 });
  const urls = manifest.map((m) => (typeof m === "string" ? m : m.href)).map(https);
  const find = (re: RegExp) => urls.find((u) => re.test(u));
  // "large" is about 720p; "medium" is a fallback. "orig" can be enormous.
  const large = find(/~large\.mp4$/i);
  const file = large ?? find(/~medium\.mp4$/i);
  if (!file) return null;
  // Frames 2 and 3 are from the middle of the clip, which is the part the reel uses
  // (see START_FRACTION); the first frame is usually a title slate.
  const frames = [find(/~medium_2\.jpg$/i), find(/~medium_3\.jpg$/i)].filter((u): u is string => Boolean(u));
  const previews = frames.length ? frames : [find(/~medium\.jpg$/i) ?? find(/~thumb\.jpg$/i)].filter((u): u is string => Boolean(u));
  return {
    source: "nasa",
    id: meta.nasa_id,
    url: file,
    width: large ? 1280 : 854,
    height: large ? 720 : 480,
    durationSec: 10,
    pageUrl: `https://images.nasa.gov/details/${encodeURIComponent(meta.nasa_id)}`,
    author: meta.center ? `NASA ${meta.center}` : "NASA",
    previewImages: previews,
    title: [meta.title, (meta.keywords ?? []).join(" "), stripHtml(meta.description, 160)].filter(Boolean).join(" "),
    license: "Public domain (NASA)",
  };
}

export async function searchNasaClips(query: string, limit = 5): Promise<StockClip[]> {
  const params = new URLSearchParams({ q: query, media_type: "video", page_size: String(Math.min(limit * 2, 10)) });
  const body = await getJson<{ collection?: { items?: NasaItem[] } }>(`https://images-api.nasa.gov/search?${params}`);
  const items = (body.collection?.items ?? []).slice(0, Math.min(limit * 2, 10));
  const settled = await Promise.allSettled(items.map(toClip));
  return settled
    .flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []))
    .slice(0, limit);
}
