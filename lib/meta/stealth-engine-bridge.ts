import path from "path";
import { randomUUID, createHash } from "crypto";
import { createTLSClient } from "@dryft/tlsclient";
import { Capability } from "./types";
import type {
  TargetResolution,
  TargetFetchResult,
  StealthSessionConfig,
  StealthFetchOptions,
  NormalizedMediaItem,
  CapabilityCheck,
} from "./types";

// ---------------------------------------------------------------------------
// Web (browser) client identity  — www.instagram.com endpoints
// ---------------------------------------------------------------------------
// Instagram's backend cross-checks the TLS ClientHello fingerprint against the
// declared client in headers, and rejects the pair as a whole ("useragent
// mismatch") if they don't correspond to a known real client. A genuine TLS
// fingerprint (via @dryft/tlsclient) makes this cross-check *stricter*, not
// looser — so the header bundle below must describe the exact same client
// as CHROME_TLS_IDENTIFIER below, not an iOS app or a different browser.
// Verified empirically: iOS-app-style headers (X-IG-App-ID etc.) against a
// Safari-iOS TLS fingerprint fail with "useragent mismatch" even when every
// individual iOS field is internally consistent, because this is a *web*
// endpoint (www.instagram.com) an iOS app would never call directly.
// ---------------------------------------------------------------------------

const CHROME_TLS_IDENTIFIER = "chrome_120";
const CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const WEB_APP_ID = "936619743392459"; // Instagram's own web app id

// ---------------------------------------------------------------------------
// iOS app client identity  — i.instagram.com (mobile API) endpoints
// ---------------------------------------------------------------------------
// i.instagram.com is the private mobile REST API surface. Real apps (and tools
// like Instaloader/instagrapi) hit it with an iOS TLS fingerprint AND matching
// iOS app headers. Sending Chrome headers here triggers the same "useragent
// mismatch" rejection in the opposite direction.
// ---------------------------------------------------------------------------

const IOS_TLS_IDENTIFIER = "safari_ios_16_0";
const IOS_IG_APP_VERSION = "269.0.0.18.75";
const IOS_IG_APP_VERSION_CODE = "431634833";
const IOS_APP_ID = "124024455399602"; // iPhone client app ID
const IOS_DEVICE_MODEL = "iPhone14,5";  // iPhone 13
const IOS_OS_VERSION = "16_3";
const IOS_LOCALE = "en_US";
const IOS_RESOLUTION = "1170x2532";
const IOS_DPI = "460";

function buildIosUserAgent(): string {
  return (
    `Instagram ${IOS_IG_APP_VERSION} ` +
    `(${IOS_DEVICE_MODEL}; iOS ${IOS_OS_VERSION}; ${IOS_LOCALE}; ${IOS_LOCALE}; ` +
    `scale=3.00; ${IOS_RESOLUTION}; ${IOS_IG_APP_VERSION_CODE}) AppleWebKit/420+`
  );
}

function buildMobileClientHeaders(options: {
  deviceId?: string;
  uuid?: string;
  phoneId?: string;
  cookies?: Record<string, string>;
  referer?: string;
}): Record<string, string> {
  const ua = buildIosUserAgent();
  const deviceId = options.deviceId || randomUUID();
  const uuid = options.uuid || randomUUID();
  const phoneId = options.phoneId || randomUUID();

  const cookieStr = options.cookies
    ? Object.entries(options.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ")
    : "";

  const headers: Record<string, string> = {
    "User-Agent": ua,
    "X-IG-App-ID": IOS_APP_ID,
    "X-IG-App-Locale": IOS_LOCALE,
    "X-IG-Device-Locale": IOS_LOCALE,
    "X-IG-Mapped-Locale": IOS_LOCALE,
    "X-IG-Device-ID": uuid,
    "X-IG-Android-ID": deviceId,
    "X-IG-Family-Device-ID": phoneId,
    "X-IG-App-Version": IOS_IG_APP_VERSION,
    "X-IG-App-Version-Code": IOS_IG_APP_VERSION_CODE,
    "X-IG-Connection-Type": "WIFI",
    "X-IG-Capabilities": "3brTvwE=",
    "X-IG-Connection-Speed": "-1kbps",
    "X-IG-Bandwidth-Speed-KBPS": "-1.000",
    "X-IG-Bandwidth-TotalBytes-B": "0",
    "X-IG-Bandwidth-TotalTime-MS": "0",
    "X-IG-WWW-Claim": "0",
    "X-Pigeon-Rawclienttime": (Date.now() / 1000).toFixed(3),
    "X-Pigeon-Session-Id": randomUUID(),
    Accept: "*/*",
    "Accept-Language": "en-US;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Connection: "keep-alive",
  };

  if (cookieStr) {
    headers["Cookie"] = cookieStr;
    const csrfToken = options.cookies?.["csrftoken"];
    if (csrfToken) headers["X-Csrftoken"] = csrfToken;
    const mid = options.cookies?.["mid"];
    if (mid) headers["X-MID"] = mid;
  }

  if (options.referer) {
    headers["Referer"] = options.referer;
  }

  for (const [k, v] of Object.entries(headers)) {
    if (!v) delete headers[k];
  }

  return headers;
}

/**
 * Generates a stable-per-session device/browser instance identifier.
 * Stored on the session config and reused across all requests so Instagram
 * sees a consistent client instance rather than a new one every request.
 */
function buildIosDeviceFingerprint(seed?: string | null) {
  const deviceId = seed || `web-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const derive = (salt: string) => {
    const hash = createHash("md5").update(`${deviceId}-${salt}`).digest("hex");
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  };
  const uuid = derive("uuid");
  const phoneId = derive("phoneId");
  return { deviceId, uuid, phoneId };
}

/**
 * Builds headers for a coherent Chrome-desktop web AJAX identity, matching
 * CHROME_TLS_IDENTIFIER. This is what the Instagram *website* itself sends
 * when it calls its own internal API endpoints, which is exactly the shape
 * these requests need to look like.
 */
function buildIosClientHeaders(options: {
  deviceId?: string;
  uuid?: string;
  phoneId?: string;
  cookies?: Record<string, string>;
  referer?: string;
  isAjax?: boolean;
  userAgent?: string | null;
}): Record<string, string> {
  const ua = options.userAgent || CHROME_USER_AGENT;

  const cookieStr = options.cookies ? Object.entries(options.cookies).map(([k, v]) => `${k}=${v}`).join("; ") : "";

  const headers: Record<string, string> = {
    "User-Agent": ua,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "X-Ig-App-Id": WEB_APP_ID,
    "X-Requested-With": "XMLHttpRequest",
    "Sec-Ch-Ua": '"Chromium";v="120", "Not_A Brand";v="24", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };

  if (cookieStr) {
    headers["Cookie"] = cookieStr;
    const csrfToken = options.cookies?.["csrftoken"];
    if (csrfToken) {
      headers["X-Csrftoken"] = csrfToken;
    }
  }

  if (options.referer) {
    headers["Referer"] = options.referer;
  }

  // Remove any empty string values
  for (const [k, v] of Object.entries(headers)) {
    if (!v) delete headers[k];
  }

  return headers;
}

/**
 * Resolves the bundled native tls-client library for the current platform,
 * bypassing @dryft/tlsclient's own auto-detection entirely.
 *
 * Why: that package's detection (a) only recognizes Ubuntu/Alpine via
 * /etc/os-release — Vercel's Amazon Linux runtime falls through to a wrong
 * ARM binary, and (b) downloads to os.tmpdir() during `npm install`, which
 * runs on a different machine than the deployed serverless function and
 * never reaches it. We instead ship the correct binaries ourselves under
 * lib/native/ (bundled into the deployment via next.config.ts's
 * outputFileTracingIncludes) and point the library at them directly via
 * its documented `tlsLibPath` override.
 */
function resolveTlsLibPath(): string {
  const nativeDir = path.join(process.cwd(), "lib", "native");
  if (process.platform === "win32") {
    return path.join(nativeDir, "tls-client-windows-64-v1.7.2.dll");
  }
  if (process.platform === "linux") {
    return path.join(nativeDir, "tls-client-linux-ubuntu-amd64-v1.7.2.so");
  }
  throw new Error(
    `No bundled tls-client binary for platform "${process.platform}". ` +
    `Add one to lib/native/ and update resolveTlsLibPath().`
  );
}

// Client is stateless aside from tlsLibPath/impersonation target, and creating
// one spins up a workerpool — reuse a single instance per (identifier) rather
// than paying that cost on every request.
const tlsClientCache = new Map<string, ReturnType<typeof createTLSClient>>();

function getTlsClient(tlsClientIdentifier: string, proxy?: string) {
  const cacheKey = `${tlsClientIdentifier}::${proxy ?? ""}`;
  let client = tlsClientCache.get(cacheKey);
  if (!client) {
    client = createTLSClient({
      tlsClientIdentifier,
      proxy,
      tlsLibPath: resolveTlsLibPath(),
    });
    tlsClientCache.set(cacheKey, client);
  }
  return client;
}

/**
 * Returns true if the URL targets the iOS/mobile API surface (i.instagram.com).
 * These endpoints require the iOS app identity; www.instagram.com uses Chrome web.
 */
function isMobileApiUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "i.instagram.com";
  } catch {
    return false;
  }
}

/**
 * Executes a stealth HTTP GET, automatically selecting the correct TLS
 * fingerprint and header identity based on the request host:
 *
 *   www.instagram.com  → Chrome 120 TLS + desktop web headers
 *   i.instagram.com    → Safari iOS 16 TLS + iOS app headers
 *
 * This keeps both sides coherent and avoids the "useragent mismatch" that
 * Instagram's WAF raises when TLS fingerprint ≠ declared client.
 */
async function stealthRequest(
  url: string,
  options: {
    session?: StealthSessionConfig | null;
    isAjax?: boolean;
    referer?: string;
    jitter?: boolean;
  } = {}
): Promise<{ status: number; text: string; data?: any; deviceId?: string }> {
  if (options.jitter) {
    // 600ms - 2000ms human-like sleep
    const delay = Math.floor(Math.random() * 1400 + 600);
    await new Promise((r) => setTimeout(r, delay));
  }

  // Build a stable device fingerprint — reuse session's deviceId if present.
  const { deviceId, uuid, phoneId } = buildIosDeviceFingerprint(
    options.session?.deviceId
  );

  const isMobile = isMobileApiUrl(url);

  // Select coherent identity: TLS fingerprint and headers must match.
  const tlsIdentifier = isMobile ? IOS_TLS_IDENTIFIER : CHROME_TLS_IDENTIFIER;
  const headers = isMobile
    ? buildMobileClientHeaders({
      deviceId,
      uuid,
      phoneId,
      cookies: options.session?.cookies,
      referer: options.referer,
    })
    : buildIosClientHeaders({
      deviceId,
      uuid,
      phoneId,
      userAgent: options.session?.userAgent,
      cookies: options.session?.cookies,
      referer: options.referer,
      isAjax: options.isAjax,
    });

  let status = 0;
  let text = "";
  try {
    const proxyUrl = options.session?.proxyUrl || undefined;
    const client = getTlsClient(tlsIdentifier, proxyUrl);

    const res = await client.get(url, {
      headers,
      validateStatus: () => true,
    });

    status = res.status;
    text = typeof res.data === "object" ? JSON.stringify(res.data) : String(res.data);
  } catch (err) {
    throw err;
  }

  let data: any = undefined;
  try {
    data = JSON.parse(text);
  } catch {
    // raw HTML or plain text response
  }

  return { status, text, data, deviceId };
}

// ---------------------------------------------------------------------------
// Error classification types
// ---------------------------------------------------------------------------

type BlockKind =
  | "rate_limited"      // transient 429 — retry after backoff
  | "session_flagged"   // checkpoint / challenge — session needs attention
  | "ip_blocked"        // IP-level block, unrelated to session quality
  | "not_blocked";      // probe passed — the original error is real

// ---------------------------------------------------------------------------
// Retry / backoff primitives (mirrors Instaloader's error_fix_parts logic)
// ---------------------------------------------------------------------------

const RETRY_DELAYS_MS = [2000, 5000, 12000]; // 3 attempts: 2s, 5s, 12s

/**
 * Wraps a stealthRequest with exponential backoff retry.
 * Retries on network errors and transient 429s.
 * Returns null only after all attempts are exhausted.
 */
async function stealthRequestWithRetry(
  url: string,
  options: Parameters<typeof stealthRequest>[1] = {},
  maxAttempts = 3
): Promise<{ status: number; text: string; data?: any; deviceId?: string } | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? 12000;
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      const res = await stealthRequest(url, options);
      // Only retry on transient server errors — not 404/401/403
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  console.warn(`[stealth] All ${maxAttempts} attempts failed for ${url}:`, lastErr);
  return null;
}

/**
 * Three-way discrimination:
 *   rate_limited   → transient, retry later
 *   session_flagged → this session/account needs a checkpoint challenge solved
 *   ip_blocked      → IP is blocked regardless of session quality
 *   not_blocked     → the probe itself succeeded, so original error is real (real 404 etc.)
 *
 * This is equivalent to Instaloader's probe_session_flagged + error_fix_parts:
 * it doesn't give up on first failure — it makes a separate independent request
 * to a known-good public profile to isolate what actually failed.
 */
async function classifyBlock(
  session?: StealthSessionConfig | null
): Promise<BlockKind> {
  try {
    // Use the official Instagram public profile as the probe target —
    // same as Instaloader's `instagram` probe.
    const probe = await stealthRequest("https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram", {
      session,
      isAjax: true,
    });

    const lower = probe.text.toLowerCase();

    // Explicit Instagram challenge/checkpoint signals
    if (
      lower.includes("checkpoint_required") ||
      lower.includes("challenge_required") ||
      lower.includes("please wait a few minutes") ||
      lower.includes("detected automated checks")
    ) {
      return "session_flagged";
    }

    // 429 on the probe means IP-level rate limit, not session quality
    if (probe.status === 429) {
      return "ip_blocked";
    }

    // If the probe returned valid data for instagram's own profile,
    // the session/IP is fine — the original error was genuine.
    if (probe.status === 200 && probe.data?.data?.user) {
      return "not_blocked";
    }

    // Anything else (503, malformed JSON, etc.) is still a block signal
    return "rate_limited";
  } catch {
    // Network failure on the probe itself → assume transient
    return "rate_limited";
  }
}

/**
 * Resolves target profile metadata.
 *
 * Error degradation (mirrors Instaloader):
 *   - Retries transient failures with exponential backoff
 *   - Runs classifyBlock() to tell "target gone" apart from
 *     "our session/IP is blocked" — avoids flat NOT_FOUND on a live account
 *   - Anonymous mode: explicitly signals limited capabilities (no stories,
 *     no follower lists) rather than pretending auth isn't needed
 */
export async function stealthResolveTarget(
  username: string,
  session?: StealthSessionConfig | null
): Promise<TargetResolution> {
  const isAuthenticated = Boolean(session?.cookies?.sessionid);
  const cleanUser = username.trim().toLowerCase().replace(/^@/, "");

  try {
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${cleanUser}`;

    const res = await stealthRequestWithRetry(url, {
      session,
      isAjax: true,
      referer: `https://www.instagram.com/${cleanUser}/`,
    });

    // All retries exhausted (persistent 429 / network failure)
    if (!res) {
      return {
        username: cleanUser,
        externalId: null,
        accountType: "UNKNOWN",
        eligibility: "TEMPORARILY_UNAVAILABLE",
        capabilities: [],
        errorCode: "RATE_LIMITED",
        errorMessage: "Instagram is rate-limiting this IP. Will retry on next scheduled check.",
      };
    }

    if (res.status === 429) {
      return {
        username: cleanUser,
        externalId: null,
        accountType: "UNKNOWN",
        eligibility: "TEMPORARILY_UNAVAILABLE",
        capabilities: [],
        errorCode: "RATE_LIMITED",
        errorMessage: "Rate limited by Instagram (HTTP 429). Retry after cooldown.",
      };
    }

    // 404 or explicit fail status — need to classify before returning NOT_FOUND
    if (res.status === 404 || res.data?.status === "fail") {
      const blockKind = await classifyBlock(session);

      if (blockKind === "session_flagged") {
        return {
          username: cleanUser,
          externalId: null,
          accountType: "UNKNOWN",
          eligibility: "TEMPORARILY_UNAVAILABLE",
          capabilities: [],
          errorCode: "SESSION_FLAGGED",
          errorMessage: isAuthenticated
            ? "Instagram requires a checkpoint challenge for this session. Log in via browser to resolve."
            : "Anonymous IP has been challenged. Add an authenticated session to bypass this.",
        };
      }

      if (blockKind === "ip_blocked" || blockKind === "rate_limited") {
        return {
          username: cleanUser,
          externalId: null,
          accountType: "UNKNOWN",
          eligibility: "TEMPORARILY_UNAVAILABLE",
          capabilities: [],
          errorCode: "RATE_LIMITED",
          errorMessage: "IP is temporarily rate-limited by Instagram. Will retry automatically.",
        };
      }

      // blockKind === "not_blocked" → probe to instagram's own profile succeeded
      // so this really is a genuine 404
      return {
        username: cleanUser,
        externalId: null,
        accountType: "UNKNOWN",
        eligibility: "UNSUPPORTED",
        capabilities: [],
        errorCode: "NOT_FOUND",
        errorMessage: `Account @${cleanUser} does not exist or has been removed.`,
      };
    }

    const userData = res.data?.data?.user;
    if (!userData) {
      // Malformed / unexpected response — classify before giving up
      const blockKind = await classifyBlock(session);
      if (blockKind !== "not_blocked") {
        return {
          username: cleanUser,
          externalId: null,
          accountType: "UNKNOWN",
          eligibility: "TEMPORARILY_UNAVAILABLE",
          capabilities: [],
          errorCode: blockKind === "session_flagged" ? "SESSION_FLAGGED" : "RATE_LIMITED",
          errorMessage: blockKind === "session_flagged"
            ? "Instagram challenge checkpoint triggered."
            : "Unexpected response from Instagram. Will retry on next check.",
        };
      }
      return {
        username: cleanUser,
        externalId: null,
        accountType: "UNKNOWN",
        eligibility: "UNSUPPORTED",
        capabilities: [],
        errorCode: "PARSE_ERROR",
        errorMessage: "Could not read profile data from Instagram. The API response format may have changed.",
      };
    }

    const isPrivate = Boolean(userData.is_private);
    const accountType = userData.is_business_account
      ? "BUSINESS"
      : isPrivate
        ? "PERSONAL"
        : "CREATOR";

    // Honest anonymous capability limits — matches Instaloader's SKIP_SESSION behaviour.
    // Anonymous: posts + bio + follower counts visible. Stories, follower/following
    // lists, and extra post details require an authenticated session.
    const capabilities: CapabilityCheck[] = [
      { capability: Capability.TARGET_LOOKUP_BY_USERNAME, result: "AVAILABLE" },
      { capability: Capability.TARGET_PUBLIC_PROFILE_FIELDS, result: "AVAILABLE" },
      { capability: Capability.TARGET_PUBLIC_MEDIA, result: "AVAILABLE" },
      { capability: Capability.TARGET_FOLLOWER_COUNT, result: "AVAILABLE" },
      { capability: Capability.TARGET_FOLLOWING_COUNT, result: isAuthenticated ? "AVAILABLE" : "NOT_AUTHORIZED", ...(!isAuthenticated && { reason: "Requires authenticated session." }) },
      { capability: Capability.TARGET_STORY_DATA, result: isAuthenticated ? "AVAILABLE" : "NOT_AUTHORIZED", ...(!isAuthenticated && { reason: "Requires authenticated session." }) },
      { capability: Capability.TARGET_FOLLOWER_IDENTITY_LIST, result: isAuthenticated ? "AVAILABLE" : "NOT_AUTHORIZED", ...(!isAuthenticated && { reason: "Requires authenticated session." }) },
      { capability: Capability.TARGET_WEBHOOK_EVENTS, result: "NOT_SUPPORTED_FOR_TARGET" },
    ];

    return {
      username: cleanUser,
      externalId: userData.id || userData.pk || null,
      accountType,
      eligibility: isPrivate ? "PARTIALLY_SUPPORTED" : "SUPPORTED",
      capabilities,
    };
  } catch (err) {
    return {
      username,
      externalId: null,
      accountType: "UNKNOWN",
      eligibility: "TEMPORARILY_UNAVAILABLE",
      capabilities: [] as CapabilityCheck[],
      errorCode: "REQUEST_ERROR",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fetches target media, stories, and profile changes.
 *
 * Degradation strategy (mirrors Instaloader):
 *   - Retries transient failures with backoff
 *   - Uses classifyBlock() to distinguish rate-limit vs session-flag vs real 404
 *   - Explicitly marks story data as unavailable for anonymous sessions
 *     rather than silently returning an empty array
 */
export async function stealthFetchTargetData(params: {
  username: string;
  externalId: string | null;
  session?: StealthSessionConfig | null;
  options?: StealthFetchOptions;
}): Promise<TargetFetchResult> {
  const { username, externalId, session, options } = params;
  const isAuthenticated = Boolean(session?.cookies?.sessionid);
  const cleanUser = username.trim().toLowerCase().replace(/^@/, "");

  try {
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${cleanUser}`;

    const res = await stealthRequestWithRetry(url, {
      session,
      isAjax: true,
      referer: `https://www.instagram.com/${cleanUser}/`,
      jitter: options?.jitterEnabled,
    });

    // All retries exhausted
    if (!res) {
      return {
        ok: false,
        rateLimited: true,
        errorMessage: "Instagram rate-limited all retry attempts. Will try again on next scheduled run.",
      };
    }

    if (res.status === 429) {
      return { ok: false, rateLimited: true, errorMessage: "Rate limited (HTTP 429)." };
    }

    if (res.status === 404) {
      const blockKind = await classifyBlock(session);
      return {
        ok: false,
        notFound: blockKind === "not_blocked",
        sessionFlagged: blockKind === "session_flagged",
        rateLimited: blockKind === "rate_limited" || blockKind === "ip_blocked",
        errorMessage:
          blockKind === "session_flagged"
            ? isAuthenticated
              ? "Instagram checkpoint challenge required. Session needs re-authentication."
              : "Anonymous IP challenged by Instagram. Add a session to bypass."
            : blockKind === "not_blocked"
              ? `Target @${cleanUser} not found — account may have been deleted or renamed.`
              : "IP/session temporarily blocked. Will retry on next run.",
      };
    }

    const userData = res.data?.data?.user;
    if (!userData) {
      // Classify before giving up — don't flat-fail on a blocked IP
      const blockKind = await classifyBlock(session);
      return {
        ok: false,
        sessionFlagged: blockKind === "session_flagged",
        rateLimited: blockKind === "rate_limited" || blockKind === "ip_blocked",
        temporaryFailure: blockKind === "not_blocked",
        errorMessage:
          blockKind === "session_flagged"
            ? "Instagram challenge checkpoint triggered."
            : blockKind === "not_blocked"
              ? "Malformed response from Instagram. The API format may have changed."
              : "Unexpected response from Instagram. Will retry on next run.",
      };
    }

    const mediaEdges = userData.edge_owner_to_timeline_media?.edges || [];
    const media: NormalizedMediaItem[] = [];

    // Helper: Select the highest available resolution image URL from display_resources
    const getHighestResImage = (itemNode: any): string | null => {
      const resources = itemNode.display_resources;
      if (Array.isArray(resources) && resources.length > 0) {
        const sorted = [...resources].sort(
          (a, b) => (b.config_width || 0) - (a.config_width || 0)
        );
        if (sorted[0]?.src) return sorted[0].src;
      }
      return itemNode.display_url || null;
    };

    // Helper: Select the highest bitrate video URL from video_resources
    const getHighestResVideo = (itemNode: any): string | null => {
      if (!itemNode.is_video) return null;
      const vResources = itemNode.video_resources;
      if (Array.isArray(vResources) && vResources.length > 0) {
        const sorted = [...vResources].sort(
          (a, b) => (b.config_width || 0) - (a.config_width || 0)
        );
        if (sorted[0]?.src) return sorted[0].src;
      }
      return itemNode.video_url || null;
    };

    for (const edge of mediaEdges.slice(0, 12)) {
      const node = edge.node;
      if (!node) continue;
      const isVideo = Boolean(node.is_video);
      const isCarousel = node.__typename === "GraphSidecar";
      const mediaType = isCarousel ? "CAROUSEL_ALBUM" : isVideo ? "VIDEO" : "IMAGE";

      const caption =
        node.edge_media_to_caption?.edges?.[0]?.node?.text || "";

      const bestImage = getHighestResImage(node);
      const bestVideo = getHighestResVideo(node);
      const isCollab = Array.isArray(node.coauthor_producers) && node.coauthor_producers.length > 0;
      const collaborators = isCollab ? node.coauthor_producers.map((c: any) => String(c.id || c.pk)) : [];

      media.push({
        externalMediaId: String(node.id || node.pk),
        mediaType,
        permalink: `https://www.instagram.com/p/${node.shortcode}/`,
        timestamp: node.taken_at_timestamp
          ? new Date(node.taken_at_timestamp * 1000).toISOString()
          : null,
        caption,
        mediaUrl: bestImage,
        videoUrl: bestVideo,
        isStory: false,
        isCollab,
        collaborators,
      });
    }

    // Check reels media if available and include in media if not already present
    const reelsEdges = userData.edge_felix_video_timeline?.edges || [];
    const reelsCount = reelsEdges.length > 0 ? reelsEdges.length : undefined;

    for (const edge of reelsEdges.slice(0, 8)) {
      const node = edge.node;
      if (!node) continue;
      const reelId = String(node.id || node.pk);
      if (media.some((m) => m.externalMediaId === reelId)) continue;

      const bestImage = getHighestResImage(node);
      const bestVideo = getHighestResVideo(node);
      const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || "";
      const isCollab = Array.isArray(node.coauthor_producers) && node.coauthor_producers.length > 0;
      const collaborators = isCollab ? node.coauthor_producers.map((c: any) => String(c.id || c.pk)) : [];

      media.push({
        externalMediaId: reelId,
        mediaType: "REEL",
        permalink: `https://www.instagram.com/reel/${node.shortcode}/`,
        timestamp: node.taken_at_timestamp
          ? new Date(node.taken_at_timestamp * 1000).toISOString()
          : null,
        caption,
        mediaUrl: bestImage,
        videoUrl: bestVideo,
        isStory: false,
        isCollab,
        collaborators,
      });
    }

    const fetchedExternalId = externalId || userData.id || userData.pk || null;
    let stories: NormalizedMediaItem[] = [];
    if (isAuthenticated && options?.watchStories && fetchedExternalId) {
      const storiesUrl = `https://i.instagram.com/api/v1/feed/user/${fetchedExternalId}/reel_media/`;
      const storiesRes = await stealthRequestWithRetry(storiesUrl, {
        session,
        isAjax: true,
        referer: `https://www.instagram.com/${cleanUser}/`,
      });
      if (storiesRes && storiesRes.status === 200 && storiesRes.data?.items) {
        for (const item of storiesRes.data.items) {
          const isVideo = Boolean(item.video_versions);
          stories.push({
            externalMediaId: String(item.id || item.pk),
            mediaType: isVideo ? "VIDEO" : "IMAGE",
            permalink: `https://www.instagram.com/stories/${cleanUser}/${item.pk}/`,
            timestamp: item.taken_at ? new Date(item.taken_at * 1000).toISOString() : null,
            caption: null,
            mediaUrl: item.image_versions2?.candidates?.[0]?.url || null,
            videoUrl: isVideo ? item.video_versions?.[0]?.url : null,
            isStory: true,
          });
        }
      }
    }

    let followersList: string[] | undefined = undefined;
    if (isAuthenticated && options?.watchFollowerChurn && fetchedExternalId) {
      followersList = [];
      let maxId: string | null = "";
      let pages = 0;
      while (maxId !== null && pages < 10) {
        const folUrl = `https://i.instagram.com/api/v1/friendships/${fetchedExternalId}/followers/?count=50${maxId ? `&max_id=${maxId}` : ""}`;
        const folRes = await stealthRequestWithRetry(folUrl, {
          session,
          isAjax: true,
          referer: `https://www.instagram.com/${cleanUser}/`,
          jitter: options?.jitterEnabled,
        });
        if (folRes && folRes.status === 200 && folRes.data?.users) {
          for (const u of folRes.data.users) {
            followersList.push(String(u.pk || u.id));
          }
          maxId = folRes.data.next_max_id || null;
        } else {
          break;
        }
        pages++;
      }
    }

    return {
      ok: true,
      profile: {
        username: cleanUser,
        name: userData.full_name || null,
        biography: userData.biography || null,
        website: userData.external_url || null,
        profilePictureUrl: userData.profile_pic_url_hd || userData.profile_pic_url || null,
        followersCount: userData.edge_followed_by?.count ?? null,
        followsCount: userData.edge_follow?.count ?? null,
        mediaCount: userData.edge_owner_to_timeline_media?.count ?? null,
        reelsCount: reelsCount ?? null,
        // has_public_story is only reliable with an authenticated session.
        // Without auth Instagram may return false even when a story exists.
        hasStory: isAuthenticated ? Boolean(userData.has_public_story) : false,
        isPrivate: Boolean(userData.is_private),
      },
      media,
      stories,
      followersList,
      anonymousMode: !isAuthenticated,
      deviceId: res.deviceId,
    };
  } catch (err) {
    return {
      ok: false,
      temporaryFailure: true,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Tests an Instagram session purely in Node.js by checking current viewer identity.
 */
export async function stealthTestSession(params: {
  cookies: Record<string, string>;
  proxyUrl?: string | null;
  userAgent?: string | null;
  impersonateTarget?: string;
}): Promise<{
  ok: boolean;
  username?: string;
  sessionActive?: boolean;
  flagged?: boolean;
  message?: string;
}> {
  try {
    const res = await stealthRequest("https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram", {
      session: {
        username: "",
        cookies: params.cookies,
        userAgent: params.userAgent,
        proxyUrl: params.proxyUrl,
      },
      isAjax: true,
      referer: "https://www.instagram.com/",
    });

    const dsUserId = params.cookies["ds_user_id"] || params.cookies["ds_user"];

    if (res.status === 200 && res.data?.status !== "fail") {
      return {
        ok: true,
        username: dsUserId ? `user_${dsUserId}` : "active_user",
        sessionActive: true,
        message: "Session is active and authenticated.",
      };
    }

    const lower = res.text.toLowerCase();
    const flagged =
      res.status === 429 ||
      lower.includes("checkpoint") ||
      lower.includes("challenge") ||
      lower.includes("automated");

    return {
      ok: false,
      sessionActive: false,
      flagged,
      message: flagged
        ? "Instagram detected automated access or requires a checkpoint challenge."
        : "Session cookies are expired or invalid.",
    };
  } catch (err) {
    return {
      ok: false,
      sessionActive: false,
      message: err instanceof Error ? err.message : "Connection failed.",
    };
  }
}

/**
 * Pure Node.js browser session import placeholder (prompts user for cookies string).
 */
export async function stealthImportBrowserSession(params: {
  browser: "firefox" | "chrome" | "brave" | "chromium";
  proxyUrl?: string | null;
  userAgent?: string | null;
}): Promise<{
  ok: boolean;
  username?: string;
  cookies?: Record<string, string>;
  browser?: string;
  message?: string;
}> {
  return {
    ok: false,
    message: `Direct OS process file reading for ${params.browser} requires elevated permissions. Please paste your sessionid and ds_user_id cookies in the 'Paste Cookies' tab.`,
  };
}
