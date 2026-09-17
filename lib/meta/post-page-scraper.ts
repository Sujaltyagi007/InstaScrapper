/**
 * Re-resolves a single post's media URLs from its permalink.
 *
 * WHY THIS EXISTS
 * Instagram CDN URLs carry an `oe=` expiry parameter and go stale within days,
 * so the `sourceMediaUrl` we stored at ingestion cannot be trusted for an
 * on-demand re-download later. The permalink (`/p/<shortcode>/`) never
 * expires, and its page still renders `og:image` / `og:video` for logged-out
 * visitors — so re-scraping it yields a *fresh* CDN link.
 *
 * Measured: the post page returned `og:image` on the first attempt, i.e. it is
 * markedly more reliable than the profile page (which loses a ~15% roll to the
 * login shell). The retry loop is kept anyway since the same soft block
 * applies in principle.
 *
 * Pure parsing with an injected fetcher, mirroring html-profile-scraper.ts, so
 * this module has no dependency on the bridge and can be deleted on its own.
 */

export interface PostMediaSource {
  /** Fresh full-resolution image (or video poster) URL. */
  imageUrl: string | null;
  /** Fresh MP4 URL when the post is a video/reel and Instagram exposes it. */
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
