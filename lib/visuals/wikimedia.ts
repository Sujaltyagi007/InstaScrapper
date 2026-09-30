/**
 * Wikimedia Commons videos, restricted to CC0 and public domain so no credit
 * is required. Files are WebM/Ogg; ffmpeg reads both. Quality varies a lot
 * (great nature and science footage, less polished elsewhere).
 */
import { WIKIMEDIA_USER_AGENT, getJson, stripHtml, type StockClip } from "./types";

interface ExtValue {
  value?: string;
}

interface WikiPage {
  title: string;
  imageinfo?: {
    url: string;
    descriptionurl: string;
    thumburl?: string;
    width: number;
    height: number;
    size: number;
    mime: string;
    extmetadata?: Record<string, ExtValue>;
  }[];
}

const OPEN_LICENSE = /^(cc0|cc[- ]?zero|public domain|pd\b)/i;
const VIDEO_MIME = /^(video\/(webm|ogg|mpeg)|application\/ogg)/i;
// Whole films (a 13-minute one measured 90 MB) can't be matched to one sentence.
const MAX_BYTES = 60 * 1024 * 1024;

export async function searchWikimediaClips(query: string, limit = 5): Promise<StockClip[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${query} filetype:video`,
    gsrnamespace: "6",
    gsrlimit: String(Math.min(limit * 4, 30)),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "480",
    format: "json",
    origin: "*",
  });
  const body = await getJson<{ query?: { pages?: Record<string, WikiPage> } }>(
    `https://commons.wikimedia.org/w/api.php?${params}`,
    { headers: { "User-Agent": WIKIMEDIA_USER_AGENT } },
  );

  const clips: StockClip[] = [];
  for (const page of Object.values(body.query?.pages ?? {})) {
    const info = page.imageinfo?.[0];
    if (!info || !VIDEO_MIME.test(info.mime) || info.size > MAX_BYTES || info.height < 480) continue;
    const meta = info.extmetadata ?? {};
    const license = meta.LicenseShortName?.value ?? "";
    // The licence is the contract: anything that isn't CC0 / public domain is skipped.
    if (!OPEN_LICENSE.test(license)) continue;
    const name = page.title.replace(/^File:/, "").replace(/\.\w+$/, "").replace(/[_-]+/g, " ");
    clips.push({
      source: "wikimedia",
      id: page.title,
      url: info.url,
      width: info.width,
      height: info.height,
      durationSec: 10,
      pageUrl: info.descriptionurl,
      author: stripHtml(meta.Artist?.value, 80) || "Wikimedia Commons",
      previewImages: info.thumburl ? [info.thumburl] : [],
      title: [name, stripHtml(meta.ImageDescription?.value, 160), stripHtml(meta.Categories?.value?.replace(/\|/g, " "), 120)]
        .filter(Boolean)
        .join(" "),
      license,
    });
    if (clips.length >= limit) break;
  }
  return clips;
}
