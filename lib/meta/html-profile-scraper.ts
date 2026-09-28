
export interface HtmlScrapeResult {
  status: number;
  text: string;
  data?: any;
  deviceId?: string;
}

export type HtmlFetcher = (url: string) => Promise<{ status: number; text: string } | null>;
export const LOGIN_SHELL_STATUS = 503;
const MAX_ATTEMPTS = 14;
const RETRY_DELAY_MS = [300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000];
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


function hasFullPayload(html: string): boolean {
  return html.includes('"xig_user_by_username"');
}

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
  /**
   * Attempts in flight at once. Only for logged-out requests through a
   * rotating proxy, where every attempt leaves from a different IP, so running
   * them side by side doesn't concentrate load on any one IP. Requests carrying
   * a logged-in session must stay at 1: one account firing parallel requests
   * from several IPs is exactly what gets it flagged.
   */
  concurrency?: number;
  /**
   * Stop at the first real profile page even if it's the lite variant. Enough
   * to resolve an account (existence, type, id); checks that need exact counts,
   * bio and posts leave this off and hold out for the full page.
   */
  acceptLite?: boolean;
  /** Overrides MAX_ATTEMPTS (logged-in checks use far fewer: their page rarely needs a retry). */
  maxAttempts?: number;
}

/** Spacing between parallel launches, so hedged attempts never leave as one burst. */
const HEDGE_STAGGER_MS = 250;

export async function scrapeProfileHtml(
  username: string,
  fetcher: HtmlFetcher,
  options: ScrapeOptions = {}
): Promise<HtmlScrapeResult | null> {
  const cleanUser = username.trim().toLowerCase().replace(/^@/, "");
  const url = `https://www.instagram.com/${cleanUser}/`;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, 6));
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? MAX_ATTEMPTS, MAX_ATTEMPTS));

  let lastStatus = 0;
  let shells = 0;
  let rateLimits = 0;
  let html = null as string | null;
  let liteHtml = null as string | null;
  let early = null as HtmlScrapeResult | null;
  let done = false;
  let stoppedForDeadline = false;

  async function runAttempt(attempt: number): Promise<void> {
    const attemptStarted = Date.now();
    const res = await fetcher(url);
    if (process.env.SCRAPER_DEBUG) {
      console.log(
        `[html-scraper] @${cleanUser} attempt ${attempt + 1}: ${res ? `HTTP ${res.status}, ${Math.round(res.text.length / 1024)}KB` : "no response"} in ${Date.now() - attemptStarted}ms`,
      );
    }
    // A sibling attempt already settled it; ignore late arrivals.
    if (done || !res) return;
    lastStatus = res.status;

    // A genuine 404 is authoritative — stop retrying, report it upward so the
    // caller can surface NOT_FOUND instead of a misleading rate-limit.
    if (res.status === 404) {
      early = { status: 404, text: res.text, data: { status: "fail", message: "not_found" } };
      done = true;
      return;
    }

    // 429 means the egress IP is out of budget. Retrying only deepens the
    // hole, so give it one more chance and then report the rate-limit upward
    // rather than spending the whole attempt budget on it.
    if (res.status === 429) {
      rateLimits++;
      if (rateLimits >= 2) {
        console.warn(`[html-scraper] @${cleanUser}: rate-limited (HTTP 429) — backing off`);
        early = { status: 429, text: res.text, data: { status: "fail", message: "rate_limited" } };
        done = true;
      }
      return;
    }
    if (res.status >= 300 && res.status < 400) {
      shells++;
      return;
    }
    if (res.status !== 200) return;

    if (looksLikeRealProfile(res.text, cleanUser)) {
      if (hasFullPayload(res.text)) {
        html = res.text;
        done = true;
        return;
      }
      if (!liteHtml) liteHtml = res.text;
      if (options.acceptLite) done = true;
      return;
    }
    shells++;
  }

  // Keeps up to `concurrency` attempts in flight; each finished attempt that
  // didn't settle the result makes room for the next one.
  const inFlight = new Set<Promise<void>>();
  let launched = 0;
  while (!done) {
    while (!done && inFlight.size < concurrency && launched < maxAttempts) {
      const attempt = launched;
      const delay =
        concurrency > 1
          ? (attempt < concurrency ? attempt * HEDGE_STAGGER_MS : HEDGE_STAGGER_MS)
          : attempt > 0
            ? (RETRY_DELAY_MS[attempt - 1] ?? 6000)
            : 0;

      // Out of time: stop cleanly rather than let the platform kill the
      // function mid-request. The first attempt always runs.
      if (attempt > 0 && options.deadlineAt && Date.now() + delay + ATTEMPT_RESERVE_MS > options.deadlineAt) {
        stoppedForDeadline = true;
        break;
      }
      launched++;
      const task: Promise<void> = (async () => {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (!done) await runAttempt(attempt);
      })().finally(() => inFlight.delete(task));
      inFlight.add(task);
    }
    if (inFlight.size === 0) break;
    await Promise.race(inFlight);
    if (stoppedForDeadline && inFlight.size === 0) break;
  }
  if (early) return early;

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
      (stoppedForDeadline ? `(stopped early for time budget) ` : `after ${maxAttempts} attempts `) +
      `(${shells} login shells, last status ${lastStatus})`
    );
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
  const ogTitle = readMeta(html, "og:title") ?? "";
  const nameFromTitle = ogTitle.split("(@")[0].trim() || null;

  if (!profile && og.followers === null) {
    console.warn(`[html-scraper] @${cleanUser}: page fetched but no parseable profile data`);
    return null;
  }

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
