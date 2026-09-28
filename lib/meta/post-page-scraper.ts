import type { MediaChild } from "./types";

export interface PostMediaSource {
  imageUrl: string | null;
  videoUrl: string | null;
}

export type PostPageFetcher = (
  url: string
) => Promise<{ status: number; text: string } | null>;

const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = [400, 700, 1100, 1600, 2200];

function readMeta(html: string, property: string): string | null {
  const m = html.match(
    new RegExp(`<meta[^>]+property="${property}"[^>]+content="([^"]*)"`, "i")
  );
  return m ? decodeEntities(m[1]) : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** Unescapes the `\/` and `%3D` forms used inside embedded JSON. */
function unescapeJsonUrl(value: string): string {
  return value
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\\u00253D/g, "%3D");
}

function firstJsonMatch(html: string, key: string): string | null {
  const m = html.match(new RegExp(`"${key}":"(https:[^"]{20,})"`));
  return m ? unescapeJsonUrl(m[1]) : null;
}

/** Extracts media URLs from a post page's HTML. Exported for testing. */
export function parsePostPage(html: string): PostMediaSource {
  const imageUrl =
    readMeta(html, "og:image") ??
    firstJsonMatch(html, "display_url") ??
    firstJsonMatch(html, "display_uri") ??
    null;

  const videoUrl =
    readMeta(html, "og:video") ??
    readMeta(html, "og:video:secure_url") ??
    firstJsonMatch(html, "video_url") ??
    null;

  return { imageUrl, videoUrl };
}

/** True when the page actually rendered post media rather than a login wall. */
function isUsablePostPage(html: string): boolean {
  if (!html || html.length < 5000) return false;
  const { imageUrl } = parsePostPage(html);
  return Boolean(imageUrl);
}

/**
 * Builds the canonical post URL from a stored permalink or bare shortcode.
 * Accepts both `/p/<code>/` and `/reel/<code>/` forms.
 */
export function normalizePostUrl(permalinkOrCode: string): string | null {
  const value = permalinkOrCode.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    const match = value.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
    return match ? `https://www.instagram.com/p/${match[1]}/` : null;
  }
  if (/^[A-Za-z0-9_-]{5,20}$/.test(value)) {
    return `https://www.instagram.com/p/${value}/`;
  }
  return null;
}

export async function scrapePostMedia(
  permalinkOrCode: string,
  fetcher: PostPageFetcher
): Promise<PostMediaSource | null> {
  const url = normalizePostUrl(permalinkOrCode);
  if (!url) {
    console.warn(`[post-scraper] unrecognised permalink: ${permalinkOrCode.slice(0, 80)}`);
    return null;
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS[attempt - 1] ?? 2200));
    }

    const res = await fetcher(url);
    if (!res) continue;

    // A deleted post is authoritative — no amount of retrying will help.
    if (res.status === 404) {
      console.warn(`[post-scraper] ${url} returned 404 — post removed`);
      return null;
    }
    if (res.status !== 200) continue;
    if (!isUsablePostPage(res.text)) continue;

    return parsePostPage(res.text);
  }

  console.warn(`[post-scraper] could not resolve media for ${url} after ${MAX_ATTEMPTS} attempts`);
  return null;
}

/**
 * What Instagram's public embed page (`/p|reel/<code>/embed/`) says about a
 * post. Unlike the post page, which logged out shows only the cover, the embed
 * page carries a reel's real `video_url` and every carousel item, because
 * third-party sites have to be able to play them. Verified 2026-09-28 through
 * the logged-out Chrome transport: a reel's page had its video file, a carousel's
 * page all of its photos, first attempt each.
 */
export interface EmbedMedia {
  videoUrl: string | null;
  imageUrl: string | null;
  /** Every item of a carousel, in order; null for a single post. */
  children: MediaChild[] | null;
}

interface EmbedNode {
  is_video?: boolean;
  video_url?: string;
  display_url?: string;
  edge_sidecar_to_children?: { edges?: { node?: EmbedNode }[] };
}

/**
 * The post data sits as a JSON string under `"contextJSON":"…"`, inside a
 * script, so it's unquoted twice. Exported for testing.
 */
export function parseEmbedPage(html: string): EmbedMedia | null {
  const key = '"contextJSON":"';
  const start = html.indexOf(key);
  if (start < 0) return null;
  const from = start + key.length;
  let end = -1;
  for (let i = from; i < html.length; i++) {
    if (html[i] === "\\") { i++; continue; }
    if (html[i] === '"') { end = i; break; }
  }
  if (end < 0) return null;

  let node: EmbedNode | undefined;
  try {
    const context = JSON.parse(JSON.parse(`"${html.slice(from, end)}"`)) as { gql_data?: { shortcode_media?: EmbedNode } };
    node = context.gql_data?.shortcode_media;
  } catch {
    return null;
  }
  if (!node) return null;

  const edges = node.edge_sidecar_to_children?.edges ?? [];
  const children = edges.length
    ? edges.map(({ node: child }) => ({
      imageUrl: child?.display_url ?? null,
      videoUrl: child?.is_video ? child.video_url ?? null : null,
    }))
    : null;
  return {
    videoUrl: node.is_video ? node.video_url ?? null : null,
    imageUrl: node.display_url ?? null,
    children,
  };
}

/** `https://www.instagram.com/<p|reel>/<code>/embed/` for a stored permalink, or null. */
export function embedPageUrl(permalinkOrCode: string): string | null {
  const match = permalinkOrCode.trim().match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
  if (match) return `https://www.instagram.com/${match[1]}/${match[2]}/embed/`;
  return /^[A-Za-z0-9_-]{5,20}$/.test(permalinkOrCode.trim()) ? `https://www.instagram.com/p/${permalinkOrCode.trim()}/embed/` : null;
}

const EMBED_ATTEMPTS = 3;

export async function scrapeEmbedMedia(permalinkOrCode: string, fetcher: PostPageFetcher): Promise<EmbedMedia | null> {
  const url = embedPageUrl(permalinkOrCode);
  if (!url) return null;
  for (let attempt = 0; attempt < EMBED_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS[attempt - 1] ?? 1000));
    const res = await fetcher(url);
    if (!res) continue;
    if (res.status === 404) return null;
    if (res.status !== 200) continue;
    const parsed = parseEmbedPage(res.text);
    if (parsed) return parsed;
  }
  console.warn(`[post-scraper] embed page gave no media for ${url} after ${EMBED_ATTEMPTS} attempts`);
  return null;
}
