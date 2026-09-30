/**
 * Internet Archive vintage footage (newsreels, home movies, ads), public
 * domain only. Most items are whole films that run for minutes, which can't
 * be matched to one sentence or downloaded per clip, so only short items
 * (<= 2 minutes, <= 80 MB) are offered. Quality is low (about 640x480) but it
 * suits history and retro niches.
 */
import { getJson, type StockClip } from "./types";

interface ArchiveDoc {
  identifier: string;
  title?: string;
  creator?: string | string[];
  subject?: string | string[];
  licenseurl?: string;
}

interface ArchiveFile {
  name: string;
  format?: string;
  size?: string;
  length?: string;
  width?: string;
  height?: string;
}

const MAX_SEC = 120;
const MAX_BYTES = 80 * 1024 * 1024;
const OPEN_LICENSE = /publicdomain|\/zero\//i;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const words = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(" ") : (v ?? ""));

async function toClip(doc: ArchiveDoc): Promise<StockClip | null> {
  const meta = await getJson<{ files?: ArchiveFile[]; metadata?: { licenseurl?: string } }>(
    `https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`,
    { ms: 12_000 },
  );
  const license = doc.licenseurl ?? meta.metadata?.licenseurl ?? "";
  if (!OPEN_LICENSE.test(license)) return null;
  const file = (meta.files ?? [])
    .filter((f) => /h\.264|mpeg4/i.test(f.format ?? "") && /\.mp4$/i.test(f.name) && !/_512kb|_edit/i.test(f.name))
    .map((f) => ({ f, sec: Number(f.length), bytes: Number(f.size) }))
    .find(({ sec, bytes }) => sec > 0 && sec <= MAX_SEC && bytes > 0 && bytes <= MAX_BYTES);
  if (!file) return null;
  return {
    source: "archive",
    id: doc.identifier,
    url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(file.f.name)}`,
    width: Number(file.f.width) || 640,
    height: Number(file.f.height) || 480,
    durationSec: file.sec,
    pageUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
    author: first(doc.creator) || "Internet Archive",
    previewImages: [`https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`],
    title: `${doc.title ?? ""} ${words(doc.subject)}`.trim(),
    license: license.replace(/^https?:\/\//, ""),
  };
}

export async function searchArchiveClips(query: string, limit = 5): Promise<StockClip[]> {
  // Lucene syntax: strip anything that would be read as an operator.
  const terms = query.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!terms) return [];
  const params = new URLSearchParams({
    q: `(${terms}) AND mediatype:movies AND (collection:prelinger OR licenseurl:*publicdomain* OR licenseurl:*zero*)`,
    rows: String(Math.min(limit * 3, 15)),
    output: "json",
  });
  for (const field of ["identifier", "title", "creator", "subject", "licenseurl"]) params.append("fl[]", field);
  params.append("sort[]", "downloads desc");
  const body = await getJson<{ response?: { docs?: ArchiveDoc[] } }>(`https://archive.org/advancedsearch.php?${params}`);
  const settled = await Promise.allSettled((body.response?.docs ?? []).map(toClip));
  return settled.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : [])).slice(0, limit);
}
