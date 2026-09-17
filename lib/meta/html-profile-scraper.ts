
export interface HtmlScrapeResult {
  status: number;
  text: string;
  data?: any;
  deviceId?: string;
}

/** A single fetch of an arbitrary URL, injected by the caller. */
export type HtmlFetcher = (url: string) => Promise<{ status: number; text: string } | null>;

/**
 * Synthetic status meaning "Instagram served the logged-out wall every time."
 * Distinct from 401/403 so callers don't mistake it for a flagged session —
 * it says nothing about credentials, and the correct response is to retry
 * later, not to tell the user their session is broken.
 */
export const LOGIN_SHELL_STATUS = 503;

/**
 * A logged-out profile request lands on the real page only ~15% of the time;
 * the rest draw the login shell. Eight attempts (each on a fresh cookie jar,
 * supplied by the caller's fetcher) gets that to a usable success rate without
 * letting one lookup stall for too long. Neither jar reuse nor a crawler
 * user-agent raises the per-attempt odds — see the bridge's jar-policy note.
 */
const MAX_ATTEMPTS = 14;
/**
 * Short, near-flat delays. A soft-blocked attempt is a bare 302 with no body,
 * so it costs a few hundred ms — cheap enough that many quick tries beat a few
 * slow ones. 14 attempts at ~20% each is ~95%, in ~13s worst case.
 */
const RETRY_DELAY_MS = [
  300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000,
];

/**
 * Brace-matches the JSON object that follows `"<key>":` in `src`.
 * String-aware, so braces inside string literals don't break nesting.
 */
function extractObjectAfter(src: string, key: string, from = 0): string | null {
  const needle = `"${key}":`;
  const at = src.indexOf(needle, from);
  if (at === -1) return null;
  const start = src.indexOf("{", at + needle.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

function parseObjectAfter(src: string, key: string, from = 0): any | null {
  const raw = extractObjectAfter(src, key, from);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readMeta(html: string, property: string): string | null {
  const m = html.match(
    new RegExp(`<meta[^>]+property="${property}"[^>]+content="([^"]*)"`, "i")
  );
  return m ? decodeHtmlEntities(m[1]) : null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}


function parseOgCounts(html: string): {
  followers: number | null;
  following: number | null;
  posts: number | null;
} {
  const desc = readMeta(html, "og:description");
  const empty = { followers: null, following: null, posts: null };
  if (!desc) return empty;

  const num = (label: string): number | null => {
    const m = desc.match(new RegExp(`([\\d.,]+)\\s*([KMB])?\\s*${label}`, "i"));
    if (!m) return null;
    const base = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(base)) return null;
    const mult = m[2] ? { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase() as "K" | "M" | "B"] : 1;
    return Math.round(base * (mult ?? 1));
  };

  return { followers: num("Followers"), following: num("Following"), posts: num("Posts") };
}


function looksLikeRealProfile(html: string, username: string): boolean {
  if (!html || html.length < 5000) return false;
  const ogUrl = readMeta(html, "og:url") ?? "";
  if (ogUrl && !ogUrl.toLowerCase().includes(`/${username.toLowerCase()}`)) return false;
  const desc = readMeta(html, "og:description") ?? "";
  return /Followers/i.test(desc) || html.includes('"follower_count"');
}

/**
 * True when the page carries the full Relay prefetch payload (exact counts,
 * bio, bio_links). Instagram also serves a "lite" real profile page (~700KB
 * vs ~813KB) that has the og: tags but no such payload, so this distinguishes
 * the two and lets the retry loop hold out for the richer one.
 */
function hasFullPayload(html: string): boolean {
  return html.includes('"xig_user_by_username"');
}

/**
 * Recovers the numeric user id from a page without the Relay payload.
 *
 * This matters more than it looks: the id is what the app stores as a
 * target's externalId, so a page that yields no id resolves "successfully"
 * but cannot actually be saved as a target. All three of these keys were
 * observed carrying the same id on a lite page.
 */
function extractUserIdFallback(html: string): string | null {
  const patterns = [
    /"profile_id":"(\d+)"/,
    /profilePage_(\d+)/,
    /"props":\{"id":"(\d+)"/,
    /"user_id":"?(\d+)"?/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Instagram media_type codes → our normalized union. */
function mapMediaType(mediaType: number, productType: string): string {
  if (productType === "clips") return "REEL";
  if (mediaType === 8 || productType === "carousel_container") return "CAROUSEL_ALBUM";
  if (mediaType === 2) return "VIDEO";
  return "IMAGE";
}

/**
 * Converts one embedded timeline node into a GraphQL-ish node, matching the
 * field names `stealthFetchTargetData` already reads.
 */
function toGraphqlNode(node: any): any {
  const productType = String(node.product_type ?? "");
  const kind = mapMediaType(Number(node.media_type ?? 1), productType);
  const isVideo = kind === "VIDEO" || kind === "REEL";
  const captionText = node.caption?.text ?? "";

  return {
    id: String(node.pk ?? node.id ?? ""),
    pk: String(node.pk ?? ""),
    shortcode: node.code ?? null,
    // GraphSidecar is what the legacy API called a carousel; the bridge keys
    // its CAROUSEL_ALBUM detection off this exact string.
    __typename:
      kind === "CAROUSEL_ALBUM" ? "GraphSidecar" : isVideo ? "GraphVideo" : "GraphImage",
    is_video: isVideo,
    display_url: node.display_uri ?? null,
    display_resources: node.display_uri
      ? [{ src: node.display_uri, config_width: 1080 }]
      : [],
    // The logged-out payload carries no media URL and no timestamp; the bridge
    // already tolerates both being absent.
    video_url: null,
    video_resources: [],
    taken_at_timestamp: null,
    edge_media_to_caption: { edges: captionText ? [{ node: { text: captionText } }] : [] },
    accessibility_caption: node.accessibility_caption ?? null,
    coauthor_producers: [],
    __productType: productType,
  };
}

/**
 * Worst case for one more attempt: the retry delay plus a request that runs
 * to the transport's 10s timeout, plus a little parse/DB slack.
 */
const ATTEMPT_RESERVE_MS = 11_000;

export interface ScrapeOptions {
  /** Epoch ms after which no new attempt may start (see StealthFetchOptions). */
  deadlineAt?: number;
}

export async function scrapeProfileHtml(
  username: string,
  fetcher: HtmlFetcher,
  options: ScrapeOptions = {}
): Promise<HtmlScrapeResult | null> {
  const cleanUser = username.trim().toLowerCase().replace(/^@/, "");
  const url = `https://www.instagram.com/${cleanUser}/`;

  let lastStatus = 0;
  let shells = 0;
  let rateLimits = 0;
  let html: string | null = null;
  let liteHtml: string | null = null;

  let stoppedForDeadline = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const delay = attempt > 0 ? (RETRY_DELAY_MS[attempt - 1] ?? 6000) : 0;

    // Out of time: stop cleanly rather than let the platform kill the
    // function mid-request. The first attempt always runs.
    if (attempt > 0 && options.deadlineAt && Date.now() + delay + ATTEMPT_RESERVE_MS > options.deadlineAt) {
      stoppedForDeadline = true;
      break;
    }

    if (delay) await new Promise((r) => setTimeout(r, delay));
    const res = await fetcher(url);
    if (!res) continue;
    lastStatus = res.status;

    // A genuine 404 is authoritative — stop retrying, report it upward so the
    // caller can surface NOT_FOUND instead of a misleading rate-limit.
    if (res.status === 404) {
      return { status: 404, text: res.text, data: { status: "fail", message: "not_found" } };
    }

    // 429 means the egress IP is out of budget. Retrying only deepens the
    // hole, so give it one more chance and then report the rate-limit upward
    // rather than spending the whole attempt budget on it.
    if (res.status === 429) {
      rateLimits++;
      if (rateLimits >= 2) {
        console.warn(`[html-scraper] @${cleanUser}: rate-limited (HTTP 429) — backing off`);
        return { status: 429, text: res.text, data: { status: "fail", message: "rate_limited" } };
      }
      continue;
    }

    // 3xx: Instagram redirects logged-out profile requests to its login page.
    // The transport deliberately does not follow it, so a redirect IS the
    // soft-block signal — same meaning as the login shell, detected instantly
    // instead of after downloading a ~500KB page.
    if (res.status >= 300 && res.status < 400) {
      shells++;
      continue;
    }

    if (res.status !== 200) continue;

    if (looksLikeRealProfile(res.text, cleanUser)) {
      if (hasFullPayload(res.text)) {
        html = res.text;
        break;
      }
      // A "lite" real page: og: tags but no Relay payload, so counts are
      // abbreviated and bio/website are absent. Keep it as a fallback and
      // spend remaining attempts trying for the full version.
      if (!liteHtml) liteHtml = res.text;
      continue;
    }

    // A 200 that isn't the real profile is the inline login shell — same soft
    // block. Just try again; each attempt is an independent ~15% roll.
    shells++;
  }

  // Never got the full payload — fall back to the lite page rather than
  // failing outright. Degraded (abbreviated counts, no bio) but still enough
  // to identify and add the target.
  if (!html && liteHtml) {
    console.warn(
      `[html-scraper] @${cleanUser}: using lite profile page (no Relay payload) — ` +
      `counts will be approximate and bio/website unavailable`
    );
    html = liteHtml;
  }

  if (!html) {
    console.warn(
      `[html-scraper] @${cleanUser}: no real profile page ` +
      (stoppedForDeadline ? `(stopped early for time budget) ` : `after ${MAX_ATTEMPTS} attempts `) +
      `(${shells} login shells, last status ${lastStatus})`
    );
    // Every attempt was the logged-out wall: report that specifically, so the
    // caller doesn't fall through and blame the user's session.
    if (shells > 0) {
      return {
        status: LOGIN_SHELL_STATUS,
        text: "",
        data: { status: "fail", message: "login_shell" },
      };
    }
    return null;
  }

  const profile = parseObjectAfter(html, "xig_user_by_username");
  const og = parseOgCounts(html);

  // The posts payload lives in a *second* xig_user_by_username occurrence, so
  // search forward from just past the first one.
  const firstAt = html.indexOf('"xig_user_by_username":');
  const timeline =
    parseObjectAfter(html, "polaris_ordered_timeline_connection", firstAt + 1) ?? null;
  const edges: any[] = Array.isArray(timeline?.edges) ? timeline.edges : [];

  const nodes = edges
    .map((e) => e?.node)
    .filter(Boolean)
    .map(toGraphqlNode);

  const posts = nodes.filter((n) => n.__productType !== "clips");
  const reels = nodes.filter((n) => n.__productType === "clips");

  // Fall back to og:title ("NASA (@nasa) • Instagram photos and videos") when
  // the embedded JSON is missing, which happens on some shell variants.
  const ogTitle = readMeta(html, "og:title") ?? "";
  const nameFromTitle = ogTitle.split("(@")[0].trim() || null;

  if (!profile && og.followers === null) {
    console.warn(`[html-scraper] @${cleanUser}: page fetched but no parseable profile data`);
    return null;
  }

  // The numeric user id. `pk` from the Relay payload is authoritative; the
  // lite page has no payload, so recover it from the page's other id keys.
  // Without an id the caller can resolve the profile but cannot save it as a
  // target, so treat a missing id as a parse failure rather than returning a
  // half-usable result.
  const userId = profile?.pk ? String(profile.pk) : extractUserIdFallback(html);
  if (!userId) {
    console.warn(`[html-scraper] @${cleanUser}: profile page had no recoverable user id`);
    return null;
  }

  const followers = profile?.follower_count ?? og.followers;
  const following = profile?.following_count ?? og.following;
  const mediaCount = og.posts ?? profile?.all_media_count ?? null;

  const bioLink = Array.isArray(profile?.bio_links) ? profile.bio_links[0] : null;

  const user = {
    // The numeric user id used by the friendships/stories endpoints. Note the
    // Relay payload's sibling `id` field is the IG-business id and is NOT
    // interchangeable with this one.
    id: userId,
    pk: userId,
    username: profile?.username ?? cleanUser,
    full_name: profile?.full_name ?? nameFromTitle,
    biography: profile?.biography ?? null,
    external_url: bioLink?.url ?? null,
    profile_pic_url: profile?.profile_pic_url ?? readMeta(html, "og:image") ?? null,
    profile_pic_url_hd: profile?.profile_pic_url ?? null,
    is_private: Boolean(profile?.is_private),
    is_verified: Boolean(profile?.is_verified),
    is_business_account: false,
    // Anonymous requests can't see stories; the bridge gates hasStory on auth
    // anyway, so reporting false here is honest rather than lossy.
    has_public_story: false,
    edge_followed_by: { count: followers ?? null },
    edge_follow: { count: following ?? null },
    edge_owner_to_timeline_media: { count: mediaCount, edges: posts.map((node) => ({ node })) },
    edge_felix_video_timeline: { edges: reels.map((node) => ({ node })) },
    __source: "html" as const,
  };

  return {
    status: 200,
    text: "",
    data: { status: "ok", data: { user } },
  };
}
