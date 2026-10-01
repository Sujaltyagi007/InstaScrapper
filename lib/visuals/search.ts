/**
 * One footage search across every library that suits the niche. Results are
 * pooled, de-duplicated and ranked by how well their title/tags match what
 * the sentence needs, so the best candidate comes first and the rest are
 * ready as replacements. No AI request is spent on ranking; Gemini only
 * checks the winner (safety stage).
 */
import { getServiceKey, reportKeyOutcome, type KeyEntry, type KeyProvider } from "@/lib/ai/keys";
import { searchEuropeanaClips } from "./europeana";
import { searchArchiveClips } from "./internet-archive";
import { sourcesForNiche, type NicheLike } from "./niche-sources";
import { searchNasaClips } from "./nasa";
import { searchPexelsClips } from "./pexels";
import { searchPixabayClips } from "./pixabay";
import { clipKey, type ClipSource, type StockClip } from "./types";
import { searchWikimediaClips } from "./wikimedia";

const PER_SOURCE = 8;
const SOURCE_TIMEOUT_MS = 25_000;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX = 400;
/** Pexels' portrait results are topped up with landscape ones below this many. */
const MIN_PORTRAIT = 4;

const STOP = new Set([
  "the", "and", "with", "for", "from", "that", "this", "into", "onto", "over", "under", "near", "some", "their",
  "his", "her", "its", "are", "was", "while", "through", "across", "showing", "shows", "shot", "close", "wide",
]);

/** Libraries that need a key, and which saved key (Settings → Connections) they use. NASA, Wikimedia and the Internet Archive need none. */
const KEYED: Partial<Record<ClipSource, KeyProvider>> = { pexels: "pexels", pixabay: "pixabay", europeana: "europeana" };

/** The key each keyed library will use for this user: their own first, then the server's. */
async function sourceKeys(sources: ClipSource[], userId?: string): Promise<Map<ClipSource, KeyEntry>> {
  const keys = new Map<ClipSource, KeyEntry>();
  await Promise.all(
    sources.map(async (source) => {
      const provider = KEYED[source];
      if (!provider) return;
      const entry = await getServiceKey(provider, userId);
      if (entry) keys.set(source, entry);
    }),
  );
  return keys;
}

/** A library refusing the key (401/403) or out of quota (429) is recorded, so rotation skips it. */
function reportLibraryFailure(entry: KeyEntry | undefined, err: unknown) {
  if (!entry) return;
  const message = (err as Error)?.message ?? "";
  const status = Number(message.match(/(?:Pexels|HTTP) (\d{3})/)?.[1] ?? 0);
  if (status === 401 || status === 403) void reportKeyOutcome(entry, { kind: "invalid", message });
  else if (status === 429) void reportKeyOutcome(entry, { kind: "exhausted", message });
}

async function searchPexelsBoth(query: string, limit: number, key?: string): Promise<StockClip[]> {
  const portrait = await searchPexelsClips(query, limit, "portrait", key);
  if (portrait.length >= MIN_PORTRAIT) return portrait;
  const landscape = await searchPexelsClips(query, limit - portrait.length, "landscape", key).catch(() => []);
  return [...portrait, ...landscape];
}

const SEARCHERS: Record<ClipSource, (query: string, limit: number, key?: string) => Promise<StockClip[]>> = {
  pexels: searchPexelsBoth,
  pixabay: searchPixabayClips,
  nasa: searchNasaClips,
  wikimedia: searchWikimediaClips,
  archive: searchArchiveClips,
  europeana: searchEuropeanaClips,
};

// Pixabay's terms ask for 24h caching; it also saves requests everywhere.
// In-memory, so each server instance keeps its own.
const cache = new Map<string, { at: number; clips: StockClip[] }>();

async function cachedSearch(source: ClipSource, query: string, limit: number, apiKey?: string): Promise<StockClip[]> {
  const key = `${source}|${limit}|${query.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.clips;
  const clips = await Promise.race([
    SEARCHERS[source](query, limit, apiKey),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${source} timed out`)), SOURCE_TIMEOUT_MS)),
  ]);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), clips });
  return clips;
}

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.add(raw.length > 3 && raw.endsWith("s") ? raw.slice(0, -1) : raw);
  }
  return out;
}

const overlap = (wanted: Set<string>, have: Set<string>) =>
  wanted.size ? [...wanted].filter((t) => have.has(t)).length / wanted.size : 0;

export function scoreClip(
  clip: StockClip,
  ask: { query: string; direction: string; needSec: number; specialists: ClipSource[] },
): number {
  const have = tokens(clip.title ?? "");
  let score = 3 * overlap(tokens(ask.query), have) + 1.5 * overlap(tokens(ask.direction), have);
  if (clip.height > clip.width) score += 1; // fills the frame without cropping
  if (clip.durationSec >= ask.needSec) score += 0.5; // covers the sentence without looping
  if (ask.specialists.includes(clip.source)) score += 0.6;
  if (Math.max(clip.width, clip.height) < 1000) score -= 0.7; // soft after upscaling
  return score;
}

export interface ClipSearch {
  niche: NicheLike;
  /** The sentence's shot direction; helps rank results. */
  direction?: string;
  /** How long the sentence lasts on screen. */
  needSec: number;
  /** Clips already used or rejected, as clipKey() strings. */
  exclude?: Set<string>;
  limit?: number;
  /** Whose saved library keys to use (falls back to the server's). */
  userId?: string;
}

/** Searches every library for the niche in parallel, best match first. */
export async function searchClips(query: string, opts: ClipSearch): Promise<StockClip[]> {
  const { sources, specialists } = sourcesForNiche(opts.niche);
  const keys = await sourceKeys(sources, opts.userId);
  const active = sources.filter((s) => !KEYED[s] || keys.has(s));
  if (active.length === 0) {
    throw new Error("No footage library is set up. Add a Pexels key in Settings → Connections.");
  }

  const settled = await Promise.allSettled(active.map((s) => cachedSearch(s, query, PER_SOURCE, keys.get(s)?.key)));
  settled.forEach((r, i) => {
    if (r.status === "rejected") reportLibraryFailure(keys.get(active[i]), r.reason);
  });
  const failures = settled.flatMap((r, i) => (r.status === "rejected" ? [`${active[i]}: ${(r.reason as Error).message}`] : []));
  if (failures.length) console.warn(`[footage] "${query}": ${failures.join(" | ").slice(0, 400)}`);
  if (failures.length === active.length) throw new Error(`Footage search failed everywhere. ${failures[0]}`);

  const seen = new Set(opts.exclude ?? []);
  const pool: StockClip[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const clip of r.value) {
      const key = clipKey(clip);
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(clip);
    }
  }
  const ask = { query, direction: opts.direction ?? "", needSec: opts.needSec, specialists };
  return pool
    .map((clip) => ({ clip, score: scoreClip(clip, ask) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 12)
    .map((x) => x.clip);
}
