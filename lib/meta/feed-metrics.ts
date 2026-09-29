import type { MediaChild, MediaMetrics, NormalizedMediaItem } from "./types";

/**
 * Parses feed items from Instagram's logged-in mobile or web GraphQL response.
 * The web profile JSON and logged-out HTML page don't carry engagement counts.
 *
 * Field names come from the private API and can change without notice, so
 * every read is defensive and a missing field just leaves that metric null.
 */

interface FeedCandidate {
  url?: string;
  width?: number;
  height?: number;
}

interface FeedItem {
  id?: string;
  code?: string;
  taken_at?: number | string;
  taken_at_timestamp?: number | string;
  timestamp?: number | string;
  media_type?: number;
  product_type?: string;
  caption?: { text?: string } | null;
  like_count?: number;
  comment_count?: number;
  play_count?: number;
  ig_play_count?: number;
  view_count?: number;
  image_versions2?: { candidates?: FeedCandidate[] };
  video_versions?: FeedCandidate[];
  carousel_media?: FeedItem[];
  clips_metadata?: {
    audio_type?: string;
    music_info?: { music_asset_info?: { title?: string; display_artist?: string } } | null;
    original_sound_info?: { original_audio_title?: string; ig_artist?: { username?: string } } | null;
  } | null;
}

export interface FeedEntry {
  item: NormalizedMediaItem;
  metrics: MediaMetrics;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  const milliseconds = Number.isFinite(numeric)
    ? numeric > 1_000_000_000_000 ? numeric : numeric * 1000
    : NaN;
  const date = Number.isFinite(milliseconds) ? new Date(milliseconds) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function largest(candidates: FeedCandidate[] | undefined): string | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return [...candidates].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;
}

function audioOf(item: FeedItem): Pick<MediaMetrics, "audioTitle" | "audioArtist" | "audioIsOriginal"> {
  const clips = item.clips_metadata;
  const music = clips?.music_info?.music_asset_info;
  if (music?.title) {
    return { audioTitle: music.title, audioArtist: music.display_artist ?? null, audioIsOriginal: false };
  }
  const original = clips?.original_sound_info;
  if (original) {
    return {
      audioTitle: original.original_audio_title ?? null,
      audioArtist: original.ig_artist?.username ?? null,
      audioIsOriginal: true,
    };
  }
  return { audioTitle: null, audioArtist: null, audioIsOriginal: null };
}

export function parseFeedItems(body: unknown): FeedEntry[] {
  const items = (body as { items?: FeedItem[] } | null)?.items;
  if (!Array.isArray(items)) return [];

  const entries: FeedEntry[] = [];
  for (const raw of items) {
    // `pk` arrives as a JSON number that can exceed 2^53 and lose precision;
    // the string `id` ("<pk>_<ownerId>") is exact.
    const pk = typeof raw.id === "string" ? raw.id.split("_")[0] : null;
    if (!pk || !/^\d+$/.test(pk) || !raw.code) continue;

    const isReel = raw.product_type === "clips";
    const isCarousel = raw.media_type === 8;
    const isVideo = raw.media_type === 2;
    const cover = isCarousel ? raw.carousel_media?.[0] : raw;
    const children: MediaChild[] | undefined = isCarousel && Array.isArray(raw.carousel_media)
      ? raw.carousel_media.map((child) => ({
        imageUrl: largest(child.image_versions2?.candidates),
        videoUrl: child.media_type === 2 ? largest(child.video_versions) : null,
      }))
      : undefined;

    entries.push({
      item: {
        externalMediaId: pk,
        mediaType: isReel ? "REEL" : isCarousel ? "CAROUSEL_ALBUM" : isVideo ? "VIDEO" : "IMAGE",
        permalink: `https://www.instagram.com/${isReel ? "reel" : "p"}/${raw.code}/`,
        timestamp: isoTimestamp(raw.taken_at_timestamp) ?? isoTimestamp(raw.taken_at) ?? isoTimestamp(raw.timestamp),
        caption: raw.caption?.text ?? null,
        mediaUrl: largest(cover?.image_versions2?.candidates),
        videoUrl: largest(raw.video_versions),
        isStory: false,
        ...(children && children.length > 0 ? { children } : {}),
      },
      metrics: {
        playCount: num(raw.ig_play_count) ?? num(raw.play_count) ?? num(raw.view_count),
        likeCount: num(raw.like_count),
        commentCount: num(raw.comment_count),
        ...audioOf(raw),
      },
    });
  }
  return entries;
}

/**
 * Attaches feed metrics to items already found on the profile, and appends feed
 * items the profile didn't include (the web JSON often omits reels). Existing
 * items keep their own fields; only missing video URLs and carousel items are
 * filled in.
 */
export function mergeFeedMetrics(media: NormalizedMediaItem[], feed: FeedEntry[]): NormalizedMediaItem[] {
  const byId = new Map(media.map((m) => [m.externalMediaId, m]));
  const merged = [...media];
  for (const { item, metrics } of feed) {
    const existing = byId.get(item.externalMediaId);
    if (existing) {
      existing.metrics = metrics;
      if (!existing.videoUrl && item.videoUrl) existing.videoUrl = item.videoUrl;
      if (!existing.children && item.children) existing.children = item.children;
      if (item.mediaType === "REEL") existing.mediaType = "REEL";
    } else {
      const added = { ...item, metrics };
      merged.push(added);
      byId.set(item.externalMediaId, added);
    }
  }
  return merged;
}
