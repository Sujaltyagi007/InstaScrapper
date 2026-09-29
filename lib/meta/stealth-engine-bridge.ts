import path from "path";
import { randomUUID, createHash } from "crypto";
import { Capability } from "./types";
import type { TargetResolution, TargetFetchResult, StealthSessionConfig, StealthFetchOptions, NormalizedMediaItem, CapabilityCheck, } from "./types";
import { scrapeProfileHtml, LOGIN_SHELL_STATUS } from "./html-profile-scraper";
import { scrapeEmbedMedia, scrapePostMedia, type EmbedMedia } from "./post-page-scraper";
import { mergeFeedMetrics, parseFeedItems, type FeedEntry } from "./feed-metrics";
import { executeViaHomeWorker, HomeWorkerUnavailableError } from "./home-worker";

const CHROME_DESKTOP_VERSIONS = ["116", "117", "119", "120"] as const;

type ChromeIdentity = { tlsIdentifier: string; userAgent: string; secChUa: string };

function chromeIdentityFor(version: string): ChromeIdentity {
  return {
    tlsIdentifier: `chrome_${version}`,
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`,
    secChUa: `"Chromium";v="${version}", "Not_A Brand";v="24", "Google Chrome";v="${version}"`,
  };
}

function pickChromeDesktopIdentity(): ChromeIdentity {
  return chromeIdentityFor(CHROME_DESKTOP_VERSIONS[Math.floor(Math.random() * CHROME_DESKTOP_VERSIONS.length)]);
}

function sessionChromeIdentity(session: StealthSessionConfig): ChromeIdentity {
  const seed = session.sessionId || session.cookies?.ds_user_id || session.username || "";
  const index = createHash("md5").update(seed).digest().readUInt32BE(0) % CHROME_DESKTOP_VERSIONS.length;
  return chromeIdentityFor(CHROME_DESKTOP_VERSIONS[index]);
}

function toWebApiUrl(url: string): string {
  return url.replace(/^https:\/\/i\.instagram\.com\/api\/v1\//, "https://www.instagram.com/api/v1/");
}

const CHROME_IDENTITY = pickChromeDesktopIdentity();
const CHROME_TLS_IDENTIFIER = CHROME_IDENTITY.tlsIdentifier;
const CHROME_USER_AGENT = CHROME_IDENTITY.userAgent;
const WEB_APP_ID = "936619743392459";
const IOS_TLS_IDENTIFIER = "safari_ios_16_0";
const IOS_IG_APP_VERSION = "269.0.0.18.75";
const IOS_IG_APP_VERSION_CODE = "431634833";
const IOS_APP_ID = "124024455399602";
const IOS_DEVICE_MODEL = "iPhone14,5";
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

function buildMobileClientHeaders(options: { deviceId?: string; uuid?: string; phoneId?: string; cookies?: Record<string, string>; referer?: string; }): Record<string, string> {
  const ua = buildIosUserAgent();
  const deviceId = options.deviceId || randomUUID();
  const uuid = options.uuid || randomUUID();
  const phoneId = options.phoneId || randomUUID();

  const cookieStr = (options.cookies && typeof options.cookies === "object") ? Object.entries(options.cookies).map(([k, v]) => `${k}=${v}`).join("; ") : "";

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

function buildIosClientHeaders(options: {
  deviceId?: string;
  uuid?: string;
  phoneId?: string;
  cookies?: Record<string, string>;
  referer?: string;
  isAjax?: boolean;
  userAgent?: string | null;
  identity?: ChromeIdentity;
}): Record<string, string> {
  const identity = options.identity ?? CHROME_IDENTITY;
  const ua = options.userAgent || identity.userAgent;

  const cookieStr = (options.cookies && typeof options.cookies === "object") ? Object.entries(options.cookies).map(([k, v]) => `${k}=${v}`).join("; ") : "";

  const headers: Record<string, string> = {
    "User-Agent": ua,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "X-Ig-App-Id": WEB_APP_ID,
    "X-Requested-With": "XMLHttpRequest",
    "Sec-Ch-Ua": identity.secChUa,
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

const tlsClientCache = new Map<string, any>();

function getTlsClient(tlsClientIdentifier: string, proxy?: string) {
  const cacheKey = `${tlsClientIdentifier}::${proxy ?? ""}`;
  let client = tlsClientCache.get(cacheKey);
  if (!client) {
    const { createTLSClient } = require("@dryft/tlsclient");
    client = createTLSClient({
      tlsClientIdentifier,
      proxy,
      tlsLibPath: resolveTlsLibPath(),
    });
    tlsClientCache.set(cacheKey, client);
  }
  return client;
}

async function htmlPageFetch(
  url: string,
  session?: StealthSessionConfig | null,
  dest: "document" | "iframe" = "document",
  deadlineAt?: number,
): Promise<{ status: number; text: string } | null> {
  const proxyUrl = session?.proxyUrl || process.env.DEFAULT_PROXY_URL || undefined;
  const cookieStr = session?.cookies ? Object.entries(session.cookies).map(([k, v]) => `${k}=${v}`).join("; ") : "";
  const identity = session?.cookies?.sessionid ? sessionChromeIdentity(session) : CHROME_IDENTITY;

  const headers: Record<string, string> = {
    "User-Agent": session?.cookies?.sessionid ? identity.userAgent : session?.userAgent || identity.userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Ch-Ua": identity.secChUa,
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
  if (dest === "iframe") {
    // How a browser loads an embedded post inside another site's page.
    headers["Sec-Fetch-Dest"] = "iframe";
    headers["Sec-Fetch-Site"] = "cross-site";
    delete headers["Sec-Fetch-User"];
  }
  if (cookieStr) headers["Cookie"] = cookieStr;

  try {
    if (session?.transport === "HOME_WORKER") {
      if (!session.homeWorkerDeviceId || !session.sessionId) {
        throw new Error("Session is set to Home worker but has no paired device.");
      }
      const response = await executeViaHomeWorker(
        session.homeWorkerDeviceId,
        session.sessionId,
        { method: "GET", url, headers },
        deadlineAt ?? Date.now() + 12_000,
      );
      return { status: response.status, text: response.text };
    }

    const client = getTlsClient(identity.tlsIdentifier, proxyUrl);
    // 10s cap per request (the adapter defaults to 30s). A time-budgeted run
    // plans retries around this bound, so one hung request can't push the
    // serverless function past its limit.
    const res = await client.get(url, { headers, validateStatus: () => true, timeout: 10_000 });
    const text =
      typeof res.data === "object" ? JSON.stringify(res.data) : String(res.data ?? "");
    return { status: Number(res.status ?? 0), text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("407") || msg.toLowerCase().includes("proxy authentication")) {
      const proxyErr = new Error(`PROXY_AUTH_FAILED: ${msg}`);
      (proxyErr as any).isProxyAuthFailed = true;
      throw proxyErr;
    }
    console.warn(`[stealth] htmlPageFetch failed for ${url}:`, msg);
    return null;
  }
}

let _anonCookieCache: Record<string, string> | null = null;
let _anonCookieFetchedAt = 0;
const ANON_COOKIE_TTL_MS = 30 * 60 * 1000;

async function bootstrapAnonymousCookies(proxyUrl?: string): Promise<Record<string, string>> {
  const now = Date.now();
  if (_anonCookieCache && now - _anonCookieFetchedAt < ANON_COOKIE_TTL_MS) {
    return _anonCookieCache;
  }

  try {
    const client = getTlsClient(CHROME_TLS_IDENTIFIER, proxyUrl);
    const res = await client.get("https://www.instagram.com/", {
      headers: {
        "User-Agent": CHROME_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Ch-Ua": CHROME_IDENTITY.secChUa,
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      },
      validateStatus: () => true,
    });
    const cookies: Record<string, string> = {};
    const rawSetCookie: string | string[] | undefined = res.headers?.["set-cookie"] ?? res.headers?.["Set-Cookie"] ?? undefined;
    const cookieList: string[] = Array.isArray(rawSetCookie) ? rawSetCookie : rawSetCookie ? [rawSetCookie] : [];
    for (const line of cookieList) {
      const matches = line.matchAll(/\b(csrftoken|mid|ig_did|ig_nrcb|datr|ps_n|ps_l)=([^;,\s]+)/g);
      for (const match of matches) {
        cookies[match[1]] = match[2];
      }
    }

    // Also check res.cookies if the library ever surfaces a parsed cookie map in the future
    if ((res as any).cookies && typeof (res as any).cookies === "object") {
      for (const [k, v] of Object.entries((res as any).cookies)) {
        if (k && v) cookies[k] = String(v);
      }
    }

    if (Object.keys(cookies).length > 0) {
      _anonCookieCache = cookies;
      _anonCookieFetchedAt = now;
      console.log("[stealth] bootstrapped anonymous cookies:", Object.keys(cookies).join(", "));
    } else {
      console.warn("[stealth] homepage bootstrap returned no Set-Cookie headers");
    }

    return cookies;
  } catch (err) {
    console.warn("[stealth] cookie bootstrap failed:", err instanceof Error ? err.message : String(err));
    return {};
  }
}

function isMobileApiUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "i.instagram.com";
  } catch {
    return false;
  }
}

async function stealthRequest(
  url: string,
  options: {
    session?: StealthSessionConfig | null;
    isAjax?: boolean;
    referer?: string;
    jitter?: boolean;
    postBody?: string;  // if set, sends a POST with this URL-encoded body
    extraHeaders?: Record<string, string>;
    deadlineAt?: number;
    timeoutMs?: number;
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

  const loggedIn = Boolean(options.session?.cookies?.sessionid);
  if (loggedIn) url = toWebApiUrl(url);
  // The web app's own API calls always carry the page they came from.
  const referer = options.referer ?? (loggedIn ? "https://www.instagram.com/" : undefined);
  const identity = loggedIn ? sessionChromeIdentity(options.session!) : CHROME_IDENTITY;
  const isMobile = isMobileApiUrl(url);

  // Select coherent identity: TLS fingerprint and headers must match.
  const tlsIdentifier = isMobile ? IOS_TLS_IDENTIFIER : identity.tlsIdentifier;
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
      // User-Agent, Sec-Ch-Ua and the TLS handshake must name the same Chrome.
      userAgent: loggedIn ? identity.userAgent : options.session?.userAgent,
      cookies: options.session?.cookies,
      referer,
      isAjax: options.isAjax,
      identity,
    });

  // Merge any caller-supplied extra headers (e.g. x-csrftoken for GraphQL POSTs)
  if (options.extraHeaders) {
    Object.assign(headers, options.extraHeaders);
  }

  let status = 0;
  let text = "";
  try {
    // A burner pinned to a home worker never has its request sent from this
    // server at all — the worker executes it and posts the result back. See
    // "Home worker" in brain.md and lib/meta/home-worker.ts.
    if (options.session?.transport === "HOME_WORKER") {
      if (!options.session.homeWorkerDeviceId || !options.session.sessionId) {
        throw new Error("Session is set to Home worker but has no paired device.");
      }
      const requestBody = options.postBody !== undefined
        ? { method: "POST" as const, url, headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, body: options.postBody }
        : { method: "GET" as const, url, headers };
      const res = await executeViaHomeWorker(
        options.session.homeWorkerDeviceId,
        options.session.sessionId,
        requestBody,
        options.deadlineAt,
      );
      status = res.status;
      text = res.text;
    } else {
      const proxyUrl = options.session?.proxyUrl || process.env.DEFAULT_PROXY_URL || undefined;
      const client = getTlsClient(tlsIdentifier, proxyUrl);

      let res: any;
      if (options.postBody !== undefined) {
        // POST with URL-encoded body — exactly what instaloader.doc_id_graphql_query() does
        res = await client.post(url, options.postBody, {
          headers: {
            ...headers,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          validateStatus: () => true,
          timeout: options.timeoutMs ?? 30_000,
        });
      } else {
        res = await client.get(url, {
          headers,
          validateStatus: () => true,
          timeout: options.timeoutMs ?? 30_000,
        });
      }

      status = res.status;
      text = typeof res.data === "object" ? JSON.stringify(res.data) : String(res.data);
    }
  } catch (err) {
    if (err instanceof HomeWorkerUnavailableError) {
      // Distinctly tagged, like PROXY_AUTH_FAILED, so callers (classifyBlock /
      // handleFailedFetch) treat an offline PC as a temporary failure, never
      // as a flagged session.
      const workerErr = new Error(`HOME_WORKER_UNAVAILABLE: ${err.message}`);
      (workerErr as any).isHomeWorkerUnavailable = true;
      throw workerErr;
    }
    const msg = err instanceof Error ? err.message : String(err);
    // Surface proxy 407 failures with a clear tagged error so callers can
    // distinguish proxy-layer failures from Instagram-layer blocks.
    if (msg.includes("407") || msg.toLowerCase().includes("proxy authentication")) {
      const proxyErr = new Error(`PROXY_AUTH_FAILED: ${msg}`);
      (proxyErr as any).isProxyAuthFailed = true;
      throw proxyErr;
    }
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

type BlockKind =
  | "rate_limited"
  | "session_flagged"
  | "ip_blocked"
  | "not_blocked";

const RETRY_DELAYS_MS = [2000, 5000, 12000];

interface GraphqlFeedTokens {
  actorId: string;
  dtsg: string;
  lsd: string;
  revision: string;
  hsi: string;
}

interface GraphqlFeedResponse {
  status: number;
  text: string;
  data?: { status?: string; message?: string; error_type?: string; items?: unknown[] };
}

interface GraphqlFeedBody {
  data?: {
    xdt_api__v1__feed__user_timeline_graphql_connection?: {
      edges?: { node?: unknown }[];
    };
  };
  errors?: { message?: string }[];
}

const GRAPHQL_FEED_DOC_ID = "28570182382647478";
const GRAPHQL_FEED_TOKEN_TTL_MS = 10 * 60 * 1000;
const graphqlFeedTokenCache = new Map<string, { tokens: GraphqlFeedTokens; expiresAt: number }>();

function parseGraphqlFeedTokens(html: string, session: StealthSessionConfig): GraphqlFeedTokens | null {
  const actorId = html.match(/"actorID":"(\d+)"/)?.[1] ?? session.cookies.ds_user_id ?? "";
  const dtsg = html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/)?.[1] ?? "";
  const lsd = html.match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1] ?? "";
  const revision = html.match(/"__spin_r":(\d+)/)?.[1] ?? "";
  const hsi = html.match(/"hsi":"(\d+)"/)?.[1] ?? "";
  return actorId && dtsg && lsd && revision && hsi ? { actorId, dtsg, lsd, revision, hsi } : null;
}

async function graphqlUserFeedRequest(
  username: string,
  session: StealthSessionConfig,
  count: number,
  deadlineAt?: number,
): Promise<GraphqlFeedResponse | null> {
  const cookieKey = createHash("sha256").update(session.cookies.sessionid ?? "").digest("hex");
  const cacheKey = `${session.sessionId ?? ""}:${cookieKey}`;
  let tokens = graphqlFeedTokenCache.get(cacheKey);
  if (!tokens || tokens.expiresAt <= Date.now()) {
    const page = await htmlPageFetch(
      `https://www.instagram.com/${encodeURIComponent(username)}/`,
      session,
      "document",
      deadlineAt,
    );
    if (!page || page.status !== 200) return page;
    const parsedTokens = parseGraphqlFeedTokens(page.text, session);
    if (!parsedTokens) {
      return { status: 200, text: "Instagram web page did not include GraphQL feed tokens.", data: { status: "fail" } };
    }
    tokens = { tokens: parsedTokens, expiresAt: Date.now() + GRAPHQL_FEED_TOKEN_TTL_MS };
    graphqlFeedTokenCache.set(cacheKey, tokens);
  }

  const sum = [...tokens.tokens.dtsg].reduce((total, character) => total + character.charCodeAt(0), 0);
  const postBody = new URLSearchParams({
    av: tokens.tokens.actorId,
    __d: "www",
    __user: "0",
    __a: "1",
    __req: "b",
    __hs: "",
    dpr: "1",
    __ccg: "EXCELLENT",
    __rev: tokens.tokens.revision,
    __s: "",
    __hsi: tokens.tokens.hsi,
    __comet_req: "7",
    fb_dtsg: tokens.tokens.dtsg,
    jazoest: `2${sum}`,
    lsd: tokens.tokens.lsd,
    __spin_r: tokens.tokens.revision,
    __spin_b: "trunk",
    __spin_t: String(Math.floor(Date.now() / 1000)),
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "PolarisProfilePostsQuery",
    variables: JSON.stringify({
      data: {
        count,
        include_reel_media_seen_timestamp: true,
        include_relationship_info: true,
        latest_besties_reel_media: true,
        latest_reel_media: true,
      },
      username,
      __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: false,
      __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
      __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false,
    }),
    server_timestamps: "true",
    doc_id: GRAPHQL_FEED_DOC_ID,
  }).toString();

  const referer = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  const response = await stealthRequest("https://www.instagram.com/graphql/query", {
    session,
    isAjax: true,
    referer,
    postBody,
    deadlineAt,
    timeoutMs: 10_000,
    extraHeaders: {
      "X-Fb-Lsd": tokens.tokens.lsd,
      "X-Fb-Friendly-Name": "PolarisProfilePostsQuery",
      "X-Asbd-Id": "359341",
      "X-Root-Field-Name": "xdt_api__v1__feed__user_timeline_graphql_connection",
      Origin: "https://www.instagram.com",
    },
  });

  let body: GraphqlFeedBody | null;
  try {
    body = JSON.parse(response.text.replace(/^\s*for\s*\(\s*;;\s*\);/, "")) as GraphqlFeedBody;
  } catch {
    return { status: response.status, text: response.text, data: { status: "fail", message: "Invalid GraphQL response." } };
  }

  const edges = body?.data?.xdt_api__v1__feed__user_timeline_graphql_connection?.edges;
  if (!Array.isArray(edges)) {
    const message = Array.isArray(body?.errors)
      ? body.errors.map((error: { message?: string }) => error.message ?? "").filter(Boolean).join(" ")
      : "GraphQL response did not include a timeline.";
    return { status: response.status, text: response.text, data: { status: "fail", message } };
  }
  return { status: response.status, text: response.text, data: { items: edges.flatMap(({ node }) => node == null ? [] : [node]) } };
}

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
      // A logged-in 429 is Instagram's first warning to that account; retrying
      // it is exactly the pattern that gets a burner banned. Hand it back so the
      // caller pauses the session (session-pool COOLDOWN_HOURS).
      if (res.status === 429 && options.session?.cookies?.sessionid) return res;
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
 * Parallel HTML attempts for logged-out lookups (SCRAPER_PARALLEL, default 3).
 * Safe only because the default proxy rotates: each attempt leaves from its own
 * IP. Logged-in requests never run in parallel (see ScrapeOptions.concurrency).
 */
function anonymousConcurrency(): number {
  const n = Number(process.env.SCRAPER_PARALLEL ?? 3);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

/** Most profile-page attempts a logged-in check makes; a logged-in page almost never needs a retry. */
const AUTHENTICATED_PAGE_ATTEMPTS = 3;

/**
 * The web app's own profile query (the doc_id instaloader also uses). One
 * attempt, no retries: callers use it as a single fallback.
 */
async function graphqlProfileQuery(
  cleanUser: string,
  session: StealthSessionConfig | null | undefined,
  jitter?: boolean,
): Promise<{ status: number; text: string; data?: any; deviceId?: string } | null> {
  // A logged-in session already carries its own csrftoken; only a logged-out
  // caller needs anonymous cookies fetched first.
  const hasCsrf = Boolean(session?.cookies?.csrftoken);
  const proxyUrl = session?.proxyUrl || process.env.DEFAULT_PROXY_URL || undefined;
  const anonCookies = hasCsrf ? {} : await bootstrapAnonymousCookies(proxyUrl);
  const mergedCookies: Record<string, string> = {
    ...anonCookies,
    ...(session?.cookies ?? {}),
  };
  const csrf = mergedCookies["csrftoken"] || "";

  const postBody = new URLSearchParams({
    variables: JSON.stringify({
      username: cleanUser,
      "__relay_internal__pv__PolarisWebSchoolsEnabledrelayprovider": false,
      "enable_integrity_filters": true,
    }),
    doc_id: "27937681195819736",
    server_timestamps: "true",
  }).toString();

  const res = await stealthRequestWithRetry("https://www.instagram.com/graphql/query",  // no trailing slash — matches instaloader
    {
      session: {
        username: session?.username ?? "",
        cookies: mergedCookies,
        userAgent: session?.userAgent,
        proxyUrl: session?.proxyUrl,
        deviceId: session?.deviceId,
      },
      isAjax: true,
      referer: `https://www.instagram.com/${cleanUser}/`,
      jitter,
      postBody,
      extraHeaders: csrf ? { "x-csrftoken": csrf } : {},
    },
    1,
  );
  if (!res || res.status !== 200) return res;
  const rawUser = res.data?.data?.user ?? res.data?.user ?? null;
  return rawUser ? { ...res, data: { status: "ok", data: { user: rawUser } } } : res;
}

async function fetchProfileInfoWithFallback(cleanUser: string, session: StealthSessionConfig | null | undefined, options: { jitter?: boolean; deadlineAt?: number; acceptLite?: boolean } = {}): Promise<{ status: number; text: string; data?: any; deviceId?: string } | null> {
  const isUsable = (res: { status: number; data?: any } | null) =>
    Boolean(res && res.status !== 404 && res.status !== 429 && res.data?.status !== "fail" && res.data?.data?.user);

  const isAuthenticated = Boolean(session?.cookies?.sessionid);

  const tryHtml = () =>
    scrapeProfileHtml(cleanUser, (url) => htmlPageFetch(url, session), {
      deadlineAt: options.deadlineAt,
      concurrency: isAuthenticated ? 1 : anonymousConcurrency(),
      acceptLite: options.acceptLite,
      maxAttempts: isAuthenticated ? AUTHENTICATED_PAGE_ATTEMPTS : undefined,
    });

  if (isAuthenticated) {
    // Instagram retired web_profile_info for signed-in accounts: it answers
    // feedback_required ("try again later") however healthy the account is, so
    // calling it on every check (with retries) made a burner look like a broken
    // bot and got it rate-limited. A signed-in person opens the profile page,
    // so that's what a logged-in check does, with one GraphQL query as the only
    // fallback. Nothing here retries a 429: the caller pauses the burner instead.
    const page = await tryHtml();
    if (isUsable(page) || page?.status === 404 || page?.status === 429) return page;
    const graphql = await graphqlProfileQuery(cleanUser, session, options.jitter);
    if (isUsable(graphql)) return graphql;
    return page ?? graphql;
  }

  const htmlFirst = await tryHtml();
  if (isUsable(htmlFirst)) return htmlFirst;
  if (htmlFirst && htmlFirst.status === 404) return htmlFirst;

  // The JSON endpoints below are walled for logged-out callers and cost
  // several requests with multi-second retry delays. When a time budget is
  // nearly spent, return the HTML verdict instead of starting them — they
  // would almost certainly fail and risk the function being killed.
  if (options.deadlineAt && options.deadlineAt - Date.now() < 20_000) {
    return htmlFirst;
  }
  // Resolving (acceptLite) is interactive: the walled JSON endpoints would add
  // several seconds for a near-certain failure, so report the HTML verdict.
  if (options.acceptLite) return htmlFirst;

  // Fall through: maybe the JSON API is reachable after all.
  const referer = `https://www.instagram.com/${cleanUser}/`;
  const primary = await stealthRequestWithRetry(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${cleanUser}`, { session, isAjax: true, referer, jitter: options.jitter });
  if (isUsable(primary)) return primary;

  const fallback = await stealthRequestWithRetry(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${cleanUser}`, { session, isAjax: true, referer, jitter: options.jitter }, 1);
  if (isUsable(fallback)) return fallback;

  const graphqlRes = await graphqlProfileQuery(cleanUser, session, options.jitter);
  if (isUsable(graphqlRes)) return graphqlRes;

  if (htmlFirst && (htmlFirst.status === LOGIN_SHELL_STATUS || htmlFirst.status === 429)) {
    return htmlFirst;
  }
  return primary ?? fallback ?? graphqlRes;
}


async function classifyBlock(session?: StealthSessionConfig | null): Promise<BlockKind> {
  try {
    const globalProxy = process.env.DEFAULT_PROXY_URL;
    const probeSession: StealthSessionConfig | null = session
      ? { ...session, proxyUrl: session.proxyUrl || globalProxy || undefined }
      : globalProxy
        ? { username: "", cookies: {}, proxyUrl: globalProxy }
        : null;

    const probeProxyUrl = probeSession?.proxyUrl || process.env.DEFAULT_PROXY_URL || undefined;
    const probeCookies = await bootstrapAnonymousCookies(probeProxyUrl);
    const probeCsrf = probeCookies["csrftoken"] || "";
    const mergedProbeCookies: Record<string, string> = {
      ...probeCookies,
      ...(probeSession?.cookies ?? {}),
    };

    const probePostBody = new URLSearchParams({
      variables: JSON.stringify({
        username: "instagram", "__relay_internal__pv__PolarisWebSchoolsEnabledrelayprovider": false,
        "enable_integrity_filters": true,
      }),
      doc_id: "27937681195819736",
      server_timestamps: "true",
    }).toString();

    const probe = await stealthRequest("https://www.instagram.com/graphql/query", {
      session: { ...probeSession, username: probeSession?.username ?? "", cookies: mergedProbeCookies },
      isAjax: true,
      referer: "https://www.instagram.com/instagram/",
      postBody: probePostBody,
      extraHeaders: probeCsrf ? { "x-csrftoken": probeCsrf } : {},
    });

    const lower = probe.text.toLowerCase();
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

    const probeUser = probe.data?.data?.user ?? probe.data?.user ?? null;
    if (probe.status === 200 && probeUser) return "not_blocked";
    return "rate_limited";
  } catch {
    return "rate_limited";
  }
}


export async function stealthResolveTarget(
  username: string,
  session?: StealthSessionConfig | null
): Promise<TargetResolution> {
  const globalProxy = process.env.DEFAULT_PROXY_URL;
  const effectiveSession: StealthSessionConfig | null = session
    ? { ...session, proxyUrl: session.proxyUrl || globalProxy || undefined }
    : globalProxy ? { username: "", cookies: {}, proxyUrl: globalProxy } : null;

  const isAuthenticated = Boolean(effectiveSession?.cookies?.sessionid);
  const cleanUser = username.trim().toLowerCase().replace(/^@/, "");

  try {
    // Resolving only needs existence, type and id, which the lite page has.
    const res = await fetchProfileInfoWithFallback(cleanUser, effectiveSession, { acceptLite: true });
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

    // Instagram served the logged-out wall on every attempt. This says nothing
    // about credentials, so it must NOT be reported as a flagged session —
    // it's transient and the right advice is simply to try again.
    if (res.status === LOGIN_SHELL_STATUS) {
      return {
        username: cleanUser,
        externalId: null,
        accountType: "UNKNOWN",
        eligibility: "TEMPORARILY_UNAVAILABLE",
        capabilities: [],
        errorCode: "RATE_LIMITED",
        errorMessage:
          "Instagram served its logged-out login page instead of the profile. " +
          "This is temporary — please try again in a moment.",
      };
    }

    if (res.status === 404 || res.data?.status === "fail") {
      const blockKind = await classifyBlock(effectiveSession);
      if (blockKind === "session_flagged") {
        return {
          username: cleanUser,
          externalId: null,
          accountType: "UNKNOWN",
          eligibility: "TEMPORARILY_UNAVAILABLE",
          capabilities: [],
          errorCode: "SESSION_FLAGGED",
          errorMessage: isAuthenticated ? "Instagram requires a checkpoint challenge for this session. Log in via browser to resolve." : "Anonymous IP has been challenged. Add an authenticated session to bypass this."
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
      const blockKind = await classifyBlock(effectiveSession);
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
    const accountType = userData.is_business_account ? "BUSINESS" : isPrivate ? "PERSONAL" : "CREATOR";

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
    const msg = err instanceof Error ? err.message : String(err);
    const isProxyAuthFailed = (err as any).isProxyAuthFailed || msg.startsWith("PROXY_AUTH_FAILED");
    const isHomeWorkerUnavailable = (err as any).isHomeWorkerUnavailable || msg.startsWith("HOME_WORKER_UNAVAILABLE");
    return {
      username,
      externalId: null,
      accountType: "UNKNOWN" as const,
      eligibility: "TEMPORARILY_UNAVAILABLE" as const,
      capabilities: [] as CapabilityCheck[],
      errorCode: isProxyAuthFailed ? "PROXY_AUTH_FAILED" : isHomeWorkerUnavailable ? "HOME_WORKER_UNAVAILABLE" : "REQUEST_ERROR",
      errorMessage: isProxyAuthFailed
        ? "Proxy authentication failed (407). Check your DEFAULT_PROXY_URL credentials in .env — make sure you're using the Proxy Username/Password from Webshare's Connections tab, not your account email/password."
        : isHomeWorkerUnavailable
          ? "The paired home worker device didn't answer in time. Make sure worker/home-worker.mjs is running on that PC."
          : msg,
    };
  }
}

async function simulateHumanActions(session?: StealthSessionConfig | null) {
  const delay = (min: number, max: number) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
  const isAuthenticated = Boolean(session?.cookies?.sessionid);

  try {
    if (isAuthenticated) {
      await stealthRequestWithRetry("https://www.instagram.com/api/v1/discover/web/explore_grid/", { session, isAjax: true }, 1);
      await delay(2000, 5000);
    }

    if (isAuthenticated && session?.username) {
      await stealthRequestWithRetry(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${session.username}`, { session, isAjax: true }, 1);
      await delay(1000, 4000);
    }

    // Hashtag browsing only with a session: logged out, this endpoint is
    // walled and just adds a failed request against the proxy IP.
    if (isAuthenticated) {
      const tags = ["travel", "food", "nature", "photography", "art", "music", "fitness", "lifestyle", "design"];
      const tag = tags[Math.floor(Math.random() * tags.length)];
      await stealthRequestWithRetry(`https://www.instagram.com/api/v1/tags/web_info/?tag_name=${tag}`, { session, isAjax: true }, 1);
      await delay(2000, 5000);
    }
  } catch (err) {
    console.warn("[stealth] BeHuman simulation interrupted:", err instanceof Error ? err.message : String(err));
  }
}

async function fetchFriendshipIdList(
  kind: "followers" | "following",
  externalId: string,
  cleanUser: string,
  session: StealthSessionConfig | null | undefined,
  options: StealthFetchOptions | undefined
): Promise<{ list: string[]; verdict: SessionVerdict; status: number }> {
  const list: string[] = [];
  let maxId: string | null = "";
  let pages = 0;
  while (maxId !== null && pages < 10) {
    const url = `https://i.instagram.com/api/v1/friendships/${externalId}/${kind}/?count=50${maxId ? `&max_id=${maxId}` : ""}`;
    const res = await stealthRequestWithRetry(url, {
      session,
      isAjax: true,
      referer: `https://www.instagram.com/${cleanUser}/`,
      jitter: options?.jitterEnabled,
    });
    const verdict = sessionVerdict(res);
    if (verdict === "RATE_LIMITED" || verdict === "FLAGGED") return { list, verdict, status: res?.status ?? 0 };
    if (res && res.status === 200 && res.data?.users) {
      for (const u of res.data.users) {
        list.push(String(u.pk || u.id));
      }
      maxId = res.data.next_max_id || null;
    } else {
      break;
    }
    pages++;
  }
  return { list, verdict: "OK", status: 200 };
}

/** Turns a logged-in response's verdict into a check-level warning, if it is one. */
function warningFrom(verdict: SessionVerdict, status: number, what: string): TargetFetchResult["sessionWarning"] {
  if (verdict === "RATE_LIMITED") return { kind: "RATE_LIMITED", message: `Instagram limited the ${what} request (HTTP ${status}).` };
  if (verdict === "FLAGGED") return { kind: "FLAGGED", message: `Instagram asked this account to verify on the ${what} request (HTTP ${status}).` };
  return undefined;
}


export async function stealthFetchTargetData(params: {
  username: string;
  externalId: string | null;
  session?: StealthSessionConfig | null;
  options?: StealthFetchOptions;
}): Promise<TargetFetchResult> {
  const { username, externalId, session, options } = params;
  const globalProxy = process.env.DEFAULT_PROXY_URL;
  const effectiveSession: StealthSessionConfig | null = session
    ? { ...session, proxyUrl: session.proxyUrl || globalProxy || undefined }
    : globalProxy
      ? { username: "", cookies: {}, proxyUrl: globalProxy }
      : null;

  const isAuthenticated = Boolean(effectiveSession?.cookies?.sessionid);
  const cleanUser = username.trim().toLowerCase().replace(/^@/, "");
  // The profile (bio, counts, latest posts) reads fine logged out, so it never
  // spends a burner request: a login-page bounce there is just a logged-out
  // retry, not a warning against the account. The burner is kept for the
  // extras only a logged-in account can see (stories, lists, the feed).
  const anonymousSession: StealthSessionConfig | null = globalProxy
    ? { username: "", cookies: {}, proxyUrl: globalProxy }
    : null;

  try {
    // Browsing noise only makes sense for a logged-in session, and only
    // sometimes. Anonymous "browsing" hits walled endpoints, and extra walled
    // requests measurably raise login-shell rates on the profile page itself
    // (see brain.md), so for anonymous checks it actively hurts.
    const timeLeftMs = options?.deadlineAt ? options.deadlineAt - Date.now() : Infinity;
    if (options?.humanSimEnabled && isAuthenticated && Math.random() < 0.3 && timeLeftMs > 30_000) {
      await simulateHumanActions(effectiveSession);
    }

    const res = await fetchProfileInfoWithFallback(cleanUser, anonymousSession, {
      jitter: options?.jitterEnabled,
      deadlineAt: options?.deadlineAt,
    });
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


    if (res.status === LOGIN_SHELL_STATUS) {
      return {
        ok: false,
        rateLimited: true,
        errorMessage:
          "Instagram served its logged-out login page instead of the profile. Will retry on next run.",
      };
    }

    if (res.status === 404) {
      const blockKind = await classifyBlock(anonymousSession);
      return {
        ok: false,
        notFound: blockKind === "not_blocked",
        sessionFlagged: blockKind === "session_flagged",
        rateLimited: blockKind === "rate_limited" || blockKind === "ip_blocked",
        errorMessage: blockKind === "session_flagged" ? "Anonymous IP challenged by Instagram. Will retry on next run." : blockKind === "not_blocked" ? `Target @${cleanUser} not found — account may have been deleted or renamed.` : "IP/session temporarily blocked. Will retry on next run.",
      };
    }

    const userData = res.data?.data?.user;
    if (!userData) {
      // Classify before giving up — don't flat-fail on a blocked IP
      const blockKind = await classifyBlock(anonymousSession);
      return {
        ok: false,
        sessionFlagged: blockKind === "session_flagged",
        rateLimited: blockKind === "rate_limited" || blockKind === "ip_blocked",
        temporaryFailure: blockKind === "not_blocked",
        errorMessage: blockKind === "session_flagged" ? "Instagram challenge checkpoint triggered." : blockKind === "not_blocked" ? "Malformed response from Instagram. The API format may have changed." : "Unexpected response from Instagram. Will retry on next run.",
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

    // Anonymous HTML pages embed exactly 12 items, so this cap only binds for
    // authenticated fetches, where the JSON API can return more.
    for (const edge of mediaEdges.slice(0, 36)) {
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

    const reelsEdges = userData.edge_felix_video_timeline?.edges || [];
    const reelsCount = reelsEdges.length > 0 ? reelsEdges.length : undefined;

    for (const edge of reelsEdges.slice(0, 24)) {
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
    // Optional extras are skipped when the time budget is nearly spent; the
    // core profile + media data above is already enough for this check.
    const hasTimeForExtras = !options?.deadlineAt || options.deadlineAt - Date.now() > 12_000;
    // Logged-in extras run one attempt each, and the first warning stops the
    // rest: repeating requests after Instagram objected is what gets burners banned.
    let sessionWarning: TargetFetchResult["sessionWarning"];
    if (isAuthenticated && options?.watchStories && fetchedExternalId && hasTimeForExtras) {
      // The web app's own stories request (the iPhone-app route doesn't fit browser cookies).
      const storiesUrl = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${fetchedExternalId}`;
      const storiesRes = await stealthRequest(storiesUrl, {
        session,
        isAjax: true,
        referer: `https://www.instagram.com/${cleanUser}/`,
      }).catch(() => null);
      sessionWarning = warningFrom(sessionVerdict(storiesRes), storiesRes?.status ?? 0, "stories");
      const storyItems =
        storiesRes?.data?.reels?.[fetchedExternalId]?.items ?? storiesRes?.data?.reels_media?.[0]?.items ?? storiesRes?.data?.items;
      if (storiesRes && storiesRes.status === 200 && Array.isArray(storyItems)) {
        for (const item of storyItems) {
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

    // Play counts and audio only exist on the logged-in feed. A cold token cache
    // needs a page request before the GraphQL request; failures only omit metrics.
    let finalMedia = media;
    const hasTimeForMetrics = !options?.deadlineAt || options.deadlineAt - Date.now() > 22_000;
    if (isAuthenticated && !sessionWarning && options?.collectMetrics && fetchedExternalId && hasTimeForMetrics) {
      const feedRes = await graphqlUserFeedRequest(cleanUser, session!, 12, options?.deadlineAt).catch(() => null);
      sessionWarning = warningFrom(sessionVerdict(feedRes), feedRes?.status ?? 0, "feed");
      if (feedRes && feedRes.status === 200) {
        const feed = parseFeedItems(feedRes.data);
        finalMedia = mergeFeedMetrics(media, feed);
        if (feed.length === 0) console.warn(`[metrics] @${cleanUser}: feed returned no parseable items`);
      } else {
        console.warn(`[metrics] @${cleanUser}: feed request failed (${feedRes?.status ?? "no response"}): ${feedRes?.text.slice(0, 200) ?? ""}`);
      }
    }

    let followersList: string[] | undefined = undefined;
    let followingList: string[] | undefined = undefined;
    if (isAuthenticated && !sessionWarning && options?.watchFollowerChurn && fetchedExternalId && hasTimeForExtras) {
      const followers = await fetchFriendshipIdList("followers", fetchedExternalId, cleanUser, session, options);
      sessionWarning = warningFrom(followers.verdict, followers.status, "followers list");
      if (!sessionWarning) {
        const following = await fetchFriendshipIdList("following", fetchedExternalId, cleanUser, session, options);
        sessionWarning = warningFrom(following.verdict, following.status, "following list");
        // A half-read list would look like a mass unfollow, so churn needs both whole.
        if (!sessionWarning) {
          followersList = followers.list;
          followingList = following.list;
        }
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
        hasStory: isAuthenticated ? Boolean(userData.has_public_story) : false,
        isPrivate: Boolean(userData.is_private),
      },
      media: finalMedia,
      stories,
      followersList,
      followingList,
      anonymousMode: !isAuthenticated,
      // `res` came from the logged-out profile read, so its random device id
      // must not overwrite the burner's own stable one.
      deviceId: isAuthenticated ? undefined : res.deviceId,
      sessionWarning,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isProxyAuthFailed = (err as any).isProxyAuthFailed || msg.startsWith("PROXY_AUTH_FAILED");
    const isHomeWorkerUnavailable = (err as any).isHomeWorkerUnavailable || msg.startsWith("HOME_WORKER_UNAVAILABLE");
    return {
      ok: false,
      temporaryFailure: !isProxyAuthFailed,
      authError: isProxyAuthFailed,
      errorMessage: isProxyAuthFailed
        ? "Proxy authentication failed (407). Check your DEFAULT_PROXY_URL credentials in .env — use the Proxy Username/Password from Webshare's Connections tab."
        : isHomeWorkerUnavailable
          ? "The paired home worker device didn't answer in time. Make sure worker/home-worker.mjs is running on that PC."
          : msg,
    };
  }
}


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
    // A login-only endpoint: it returns the account's own settings when the
    // cookies are logged in and redirects to the login page when they aren't.
    // (The public profile endpoint used before answered even fake cookies, so
    // dead sessions were saved as ACTIVE — verified 2026-09-27.)
    const res = await stealthRequest("https://www.instagram.com/api/v1/accounts/edit/web_form_data/", {
      session: {
        username: "",
        cookies: params.cookies,
        userAgent: params.userAgent,
        proxyUrl: params.proxyUrl,
      },
      isAjax: true,
      referer: "https://www.instagram.com/accounts/edit/",
    });

    const loggedInAs: unknown = res.data?.form_data?.username;
    if (res.status === 200 && typeof loggedInAs === "string" && loggedInAs.length > 0) {
      return {
        ok: true,
        username: loggedInAs,
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

/**
 * Re-resolves fresh CDN URLs for a single post from its permalink.
 *
 * Used by the on-demand re-download path: the `sourceMediaUrl` stored at
 * ingestion carries an `oe=` expiry param and goes stale, whereas the
 * permalink does not, so re-scraping the post page is what actually makes
 * re-download work for older media.
 */
export async function stealthResolvePostMedia(
  permalinkOrCode: string,
  session?: StealthSessionConfig | null
): Promise<{ imageUrl: string | null; videoUrl: string | null } | null> {
  const globalProxy = process.env.DEFAULT_PROXY_URL;
  const effectiveSession: StealthSessionConfig | null = session
    ? { ...session, proxyUrl: session.proxyUrl || globalProxy || undefined }
    : globalProxy
      ? { username: "", cookies: {}, proxyUrl: globalProxy }
      : null;

  return scrapePostMedia(permalinkOrCode, (url) => htmlPageFetch(url, effectiveSession));
}

/**
 * A post's real video file and every carousel item from Instagram's public
 * embed page, logged out (rotating proxy, no burner). See parseEmbedPage.
 */
export async function stealthResolveEmbedMedia(permalinkOrCode: string): Promise<EmbedMedia | null> {
  const globalProxy = process.env.DEFAULT_PROXY_URL;
  const anonymous: StealthSessionConfig | null = globalProxy ? { username: "", cookies: {}, proxyUrl: globalProxy } : null;
  return scrapeEmbedMedia(permalinkOrCode, (url) => htmlPageFetch(url, anonymous, "iframe"));
}


/**
 * What a logged-in response says about the account that made it, so the pool
 * can stop on the first warning (see session-pool reportSessionOutcome):
 * - RATE_LIMITED: a 429, "try again later" (feedback_required) or "please wait"
 * - FLAGGED: a checkpoint/challenge, or the cookies no longer sign in
 * - OK: a normal answer; OTHER: anything else (network, 5xx), no verdict
 */
export type SessionVerdict = "OK" | "RATE_LIMITED" | "FLAGGED" | "OTHER";

export function sessionVerdict(
  res: { status: number; text: string; data?: { status?: string; message?: string; error_type?: string } } | null,
): SessionVerdict {
  if (!res) return "OTHER";
  if (res.status === 429) return "RATE_LIMITED";
  // A normal answer carries user content (captions, bios) that can contain any
  // phrase, so only error answers are read for Instagram's warning wording.
  if (res.status === 200 && res.data && res.data.status !== "fail") return "OK";
  const signal = `${res.data?.message ?? ""} ${res.data?.error_type ?? ""} ${res.text.slice(0, 2000)}`.toLowerCase();
  if (signal.includes("checkpoint_required") || signal.includes("challenge_required") || signal.includes("login_required") || res.status === 401) {
    return "FLAGGED";
  }
  if (signal.includes("feedback_required") || signal.includes("please wait a few minutes") || signal.includes("try again later")) {
    return "RATE_LIMITED";
  }
  return "OTHER";
}

export interface LoggedInLookup<T> {
  verdict: SessionVerdict;
  status: number;
  result: T;
}

/**
 * Fetches a profile's latest posts via the logged-in web GraphQL query. The
 * page tokens are cached per session; a cold cache needs one bootstrap request.
 * The query itself is attempted once so a warning stops the burner, not repeats.
 */
export async function stealthFetchUserFeed(
  username: string,
  session: StealthSessionConfig,
  count = 12,
): Promise<LoggedInLookup<FeedEntry[]>> {
  const res = await graphqlUserFeedRequest(username, session, count).catch(() => null);
  const verdict = sessionVerdict(res);
  return { verdict, status: res?.status ?? 0, result: verdict === "OK" ? parseFeedItems(res?.data) : [] };
}

/**
 * One logged-in request for a single post (by its numeric id), for loading an
 * older post's video or carousel on demand. Same no-retry rule as above.
 */
export async function stealthFetchMediaInfo(
  mediaPk: string,
  session: StealthSessionConfig,
): Promise<LoggedInLookup<FeedEntry | null>> {
  const res = await stealthRequest(`https://i.instagram.com/api/v1/media/${encodeURIComponent(mediaPk)}/info/`, {
    session,
    isAjax: true,
  }).catch(() => null);
  const verdict = sessionVerdict(res);
  return { verdict, status: res?.status ?? 0, result: verdict === "OK" ? (parseFeedItems(res?.data)[0] ?? null) : null };
}
