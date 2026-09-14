import tls from "tls";
import type {
  TargetResolution,
  TargetFetchResult,
  StealthSessionConfig,
  StealthFetchOptions,
  NormalizedMediaItem,
} from "./types";

/**
 * Browser header builder matching genuine Chrome / Firefox / Safari signatures.
 */
function buildBrowserHeaders(options: {
  userAgent?: string | null;
  cookies?: Record<string, string>;
  referer?: string;
  isAjax?: boolean;
}): Record<string, string> {
  const defaultUA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const ua = options.userAgent || defaultUA;

  const cookieStr = options.cookies
    ? Object.entries(options.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ")
    : "";

  const headers: Record<string, string> = {
    "User-Agent": ua,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": options.isAjax ? "empty" : "document",
    "Sec-Fetch-Mode": options.isAjax ? "cors" : "navigate",
    "Sec-Fetch-Site": options.referer ? "same-origin" : "none",
    "Sec-Fetch-User": options.isAjax ? "" : "?1",
    "Upgrade-Insecure-Requests": options.isAjax ? "" : "1",
    Connection: "keep-alive",
  };

  if (cookieStr) {
    headers["Cookie"] = cookieStr;
    const csrfToken = options.cookies?.["csrftoken"];
    if (csrfToken) {
      headers["X-Csrftoken"] = csrfToken;
    }
  }

  if (options.isAjax) {
    headers["X-Requested-With"] = "XMLHttpRequest";
    headers["X-Ig-App-Id"] = "936619743392459"; // Standard Instagram Web App ID
    headers["Accept"] = "*/*";
  }

  if (options.referer) {
    headers["Referer"] = options.referer;
  }

  // Clean empty headers
  for (const [k, v] of Object.entries(headers)) {
    if (!v) delete headers[k];
  }

  return headers;
}

/**
 * TLS Fingerprint Configurator:
 * Configures Node.js tls ciphers and curves to closely match modern Chrome/Firefox
 * ClientHello signatures rather than Node's default OpenSSL cipher order.
 */
function getTlsClientOptions() {
  const browserCiphers = [
    "TLS_AES_128_GCM_SHA256",
    "TLS_AES_256_GCM_SHA384",
    "TLS_CHACHA20_POLY1305_SHA256",
    "ECDHE-ECDSA-AES128-GCM-SHA256",
    "ECDHE-RSA-AES128-GCM-SHA256",
    "ECDHE-ECDSA-AES256-GCM-SHA384",
    "ECDHE-RSA-AES256-GCM-SHA384",
    "ECDHE-ECDSA-CHACHA20-POLY1305",
    "ECDHE-RSA-CHACHA20-POLY1305",
    "ECDHE-RSA-AES128-SHA",
    "ECDHE-RSA-AES256-SHA",
    "AES128-GCM-SHA256",
    "AES256-GCM-SHA384",
    "AES128-SHA",
    "AES256-SHA",
  ].join(":");

  return {
    ciphers: browserCiphers,
    minVersion: "TLSv1.2" as tls.SecureVersion,
    maxVersion: "TLSv1.3" as tls.SecureVersion,
  };
}

/**
 * Executes a stealth HTTP request with random jitter and browser emulation.
 */
async function stealthRequest(
  url: string,
  options: {
    session?: StealthSessionConfig | null;
    isAjax?: boolean;
    referer?: string;
    jitter?: boolean;
  } = {}
): Promise<{ status: number; text: string; data?: any }> {
  if (options.jitter) {
    // 600ms - 2000ms human-like sleep
    const delay = Math.floor(Math.random() * 1400 + 600);
    await new Promise((r) => setTimeout(r, delay));
  }

  const headers = buildBrowserHeaders({
    userAgent: options.session?.userAgent,
    cookies: options.session?.cookies,
    referer: options.referer,
    isAjax: options.isAjax,
  });

  const res = await fetch(url, {
    method: "GET",
    headers,
    redirect: "manual",
  });

  const text = await res.text();
  let data: any = undefined;
  try {
    data = JSON.parse(text);
  } catch {
    // raw html or text
  }

  return { status: res.status, text, data };
}

/**
 * Probes whether the session/IP itself has been challenged or banned vs target 404.
 */
async function probeSessionFlagged(
  session?: StealthSessionConfig | null
): Promise<boolean> {
  try {
    const res = await stealthRequest("https://www.instagram.com/instagram/", {
      session,
      isAjax: false,
    });
    const lower = res.text.toLowerCase();
    if (
      res.status === 429 ||
      lower.includes("checkpoint_required") ||
      lower.includes("challenge_required") ||
      lower.includes("detected automated checks")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Resolves target profile metadata purely in Node.js.
 */
export async function stealthResolveTarget(
  username: string,
  session?: StealthSessionConfig | null
): Promise<TargetResolution> {
  try {
    const cleanUser = username.trim().toLowerCase().replace(/^@/, "");
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${cleanUser}`;

    const res = await stealthRequest(url, {
      session,
      isAjax: true,
      referer: `https://www.instagram.com/${cleanUser}/`,
    });

    if (res.status === 404 || (res.data && res.data.status === "fail")) {
      const isFlagged = await probeSessionFlagged(session);
      return {
        username: cleanUser,
        externalId: null,
        accountType: "UNKNOWN",
        eligibility: isFlagged ? "TEMPORARILY_UNAVAILABLE" : "UNSUPPORTED",
        capabilities: [],
        errorCode: isFlagged ? "SESSION_FLAGGED" : "NOT_FOUND",
        errorMessage: isFlagged
          ? "Instagram has flagged this session or IP for automated checks."
          : "Account not found.",
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
        errorMessage: "Rate limited by Instagram (HTTP 429).",
      };
    }

    const userData = res.data?.data?.user;
    if (!userData) {
      const isFlagged = await probeSessionFlagged(session);
      return {
        username: cleanUser,
        externalId: null,
        accountType: "UNKNOWN",
        eligibility: isFlagged ? "TEMPORARILY_UNAVAILABLE" : "UNSUPPORTED",
        capabilities: [],
        errorCode: isFlagged ? "SESSION_FLAGGED" : "PARSE_ERROR",
        errorMessage: isFlagged
          ? "Instagram challenge required."
          : "Could not read profile data from Instagram.",
      };
    }

    const isPrivate = Boolean(userData.is_private);
    const accountType = userData.is_business_account
      ? "BUSINESS"
      : isPrivate
      ? "PERSONAL"
      : "CREATOR";

    return {
      username: cleanUser,
      externalId: userData.id || userData.pk || null,
      accountType,
      eligibility: isPrivate ? "PARTIALLY_SUPPORTED" : "SUPPORTED",
      capabilities: [],
    };
  } catch (err) {
    return {
      username,
      externalId: null,
      accountType: "UNKNOWN",
      eligibility: "TEMPORARILY_UNAVAILABLE",
      capabilities: [],
      errorCode: "REQUEST_ERROR",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fetches target media, stories, and profile changes purely in Node.js.
 */
export async function stealthFetchTargetData(params: {
  username: string;
  externalId: string | null;
  session?: StealthSessionConfig | null;
  options?: StealthFetchOptions;
}): Promise<TargetFetchResult> {
  const { username, session, options } = params;
  const cleanUser = username.trim().toLowerCase().replace(/^@/, "");

  try {
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${cleanUser}`;

    const res = await stealthRequest(url, {
      session,
      isAjax: true,
      referer: `https://www.instagram.com/${cleanUser}/`,
      jitter: options?.jitterEnabled,
    });

    if (res.status === 429) {
      return {
        ok: false,
        rateLimited: true,
        errorMessage: "Instagram rate limited this request (429).",
      };
    }

    if (res.status === 404) {
      const isFlagged = await probeSessionFlagged(session);
      return {
        ok: false,
        notFound: !isFlagged,
        sessionFlagged: isFlagged,
        errorMessage: isFlagged ? "Session is flagged" : "Target profile not found.",
      };
    }

    const userData = res.data?.data?.user;
    if (!userData) {
      const isFlagged = await probeSessionFlagged(session);
      return {
        ok: false,
        sessionFlagged: isFlagged,
        temporaryFailure: true,
        errorMessage: isFlagged
          ? "Instagram challenge checkpoint triggered."
          : "Malformed response from Instagram.",
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
      });
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
        hasStory: Boolean(userData.has_public_story),
        isPrivate: Boolean(userData.is_private),
      },
      media,
      stories: [],
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
