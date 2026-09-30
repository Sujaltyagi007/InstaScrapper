/**
 * Europeana European archive footage (mostly Dutch newsreels and city films),
 * limited to public-domain-marked and CC0 items. Needs a free key
 * (EUROPEANA_API_KEY, pro.europeana.eu). The API doesn't give file sizes, so
 * a HEAD request skips files that are too big to download per clip.
 */
import { getJson, isConfigured, type StockClip } from "./types";

interface EuropeanaItem {
  id: string;
  title?: string[];
  dataProvider?: string[];
  edmIsShownBy?: string[];
  edmIsShownAt?: string[];
  edmPreview?: string[];
  rights?: string[];
  guid?: string;
}

const OPEN_RIGHTS = /publicdomain\/(mark|zero)/i;
const PLAYABLE = /\.(mp4|webm|ogv)(\?|$)/i;
const MAX_BYTES = 80 * 1024 * 1024;

export function isEuropeanaConfigured(): boolean {
  return isConfigured(process.env.EUROPEANA_API_KEY);
}

async function withinSizeLimit(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8_000) });
    const length = Number(res.headers.get("content-length") ?? 0);
    return res.ok && (length === 0 || length <= MAX_BYTES);
  } catch {
    return false;
  }
}

export async function searchEuropeanaClips(query: string, limit = 5): Promise<StockClip[]> {
  const key = process.env.EUROPEANA_API_KEY?.trim();
  if (!key) throw new Error("EUROPEANA_API_KEY is not set.");
  const params = new URLSearchParams({
    wskey: key,
    query,
    reusability: "open",
    media: "true",
    rows: String(Math.min(limit * 3, 15)),
  });
  params.append("qf", "TYPE:VIDEO");
  const body = await getJson<{ items?: EuropeanaItem[] }>(`https://api.europeana.eu/record/v2/search.json?${params}`);

  const candidates = (body.items ?? []).filter((item) => {
    const file = item.edmIsShownBy?.[0];
    return Boolean(file && PLAYABLE.test(file) && (item.rights ?? []).some((r) => OPEN_RIGHTS.test(r)));
  });
  const sized = await Promise.all(candidates.map((item) => withinSizeLimit(item.edmIsShownBy![0])));
  return candidates
    .filter((_, i) => sized[i])
    .slice(0, limit)
    .map((item) => ({
      source: "europeana" as const,
      id: item.id,
      url: item.edmIsShownBy![0],
      width: 640,
      height: 480,
      durationSec: 10,
      pageUrl: item.edmIsShownAt?.[0] ?? item.guid ?? "https://www.europeana.eu",
      author: item.dataProvider?.[0] ?? "Europeana",
      previewImages: item.edmPreview?.[0] ? [item.edmPreview[0]] : [],
      title: item.title?.[0] ?? "",
      license: "Public domain / CC0",
    }));
}
