import path from "path";
import { randomUUID, createHash } from "crypto";
import { Capability } from "./types";
import type { TargetResolution, TargetFetchResult, StealthSessionConfig, StealthFetchOptions, NormalizedMediaItem, CapabilityCheck, } from "./types";
import { scrapeProfileHtml, LOGIN_SHELL_STATUS } from "./html-profile-scraper";

const CHROME_DESKTOP_VERSIONS = ["116", "117", "119", "120"] as const;

function pickChromeDesktopIdentity(): { tlsIdentifier: string; userAgent: string; secChUa: string } {
  const version = CHROME_DESKTOP_VERSIONS[Math.floor(Math.random() * CHROME_DESKTOP_VERSIONS.length)];
  return {
    tlsIdentifier: `chrome_${version}`,
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`,
    secChUa: `"Chromium";v="${version}", "Not_A Brand";v="24", "Google Chrome";v="${version}"`,
  };
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
}): Record<string, string> {
  const ua = options.userAgent || CHROME_USER_AGENT;

  const cookieStr = (options.cookies && typeof options.cookies === "object") ? Object.entries(options.cookies).map(([k, v]) => `${k}=${v}`).join("; ") : "";

  const headers: Record<string, string> = {
    "User-Agent": ua,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "X-Ig-App-Id": WEB_APP_ID,
    "X-Requested-With": "XMLHttpRequest",
    "Sec-Ch-Ua": CHROME_IDENTITY.secChUa,
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

let _htmlPool: any = null;


function resolveFrom(specifier: string, extraPaths: string[] = []): string {
  const candidateBases = [...extraPaths, process.cwd()];
  let lastErr: unknown;
  for (const base of candidateBases) {
    try { return require.resolve(specifier, { paths: [base] }); }
    catch (err) { lastErr = err; }
  }
  try {
    return require.resolve(specifier);
  } catch (err) {
    lastErr = err;
  }
  throw new Error(
    `Could not resolve "${specifier}" (tried ${candidateBases.join(", ")} and this module): ${lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  );
}

function getHtmlWorkerPool(): any {
  if (!_htmlPool) {
    const tlsEntry = resolveFrom("@dryft/tlsclient/lib/helpers/tls.js");
    const wpName = ["worker", "pool"].join("");
    const workerpool = eval("require")(resolveFrom(wpName, [path.dirname(tlsEntry)]));
    _htmlPool = workerpool.pool(tlsEntry, {
      workerThreadOpts: { env: { TLS_LIB_PATH: resolveTlsLibPath() } },
    });
  }
  return _htmlPool;
}

/** A fresh cookie jar id per request — see the jar-policy note above. */
function newHtmlJar(): string {
  return `ig-html-${randomUUID()}`;
}


async function htmlPageFetch(
  url: string,
  session?: StealthSessionConfig | null
): Promise<{ status: number; text: string } | null> {
  const proxyUrl = session?.proxyUrl || process.env.DEFAULT_PROXY_URL || "";
  const cookieStr = session?.cookies
    ? Object.entries(session.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ")
    : "";

  const headers: Record<string, string> = {
    "User-Agent": session?.userAgent || CHROME_USER_AGENT,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Ch-Ua": CHROME_IDENTITY.secChUa,
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
  if (cookieStr) headers["Cookie"] = cookieStr;

  const payload = {
    tlsClientIdentifier: CHROME_TLS_IDENTIFIER,
    followRedirects: true,
    insecureSkipVerify: true,
    withoutCookieJar: false,
    withDefaultCookieJar: true,
    isByteRequest: false,
    catchPanics: false,
    withDebug: false,
    forceHttp1: false,
    withRandomTLSExtensionOrder: true,
    timeoutSeconds: 30,
    timeoutMilliseconds: 0,
    sessionId: newHtmlJar(),
    isRotatingProxy: false,
    proxyUrl,
    certificatePinningHosts: {},
    headers,
    headerOrder: [],
    requestUrl: url,
    requestMethod: "GET",
  };
  const pool = getHtmlWorkerPool();

  try {
    const raw = await pool.exec("request", [JSON.stringify(payload)]);
    const res = JSON.parse(raw);
    if (res?.status === 407) {
      const err = new Error("PROXY_AUTH_FAILED: proxy rejected credentials (407)");
      (err as any).isProxyAuthFailed = true;
      throw err;
    }
    const body = typeof res?.body === "object" ? JSON.stringify(res.body) : String(res?.body ?? "");
    return { status: Number(res?.status ?? 0), text: body };
  } catch (err) {
    if ((err as any)?.isProxyAuthFailed) throw err;
    console.warn(`[stealth] htmlPageFetch failed for ${url}:`, err);
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

  // Merge any caller-supplied extra headers (e.g. x-csrftoken for GraphQL POSTs)
  if (options.extraHeaders) {
    Object.assign(headers, options.extraHeaders);
  }

  let status = 0;
  let text = "";
  try {
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
      });
    } else {
      res = await client.get(url, {
        headers,
        validateStatus: () => true,
      });
    }

    status = res.status;
    text = typeof res.data === "object" ? JSON.stringify(res.data) : String(res.data);
  } catch (err) {
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

async function fetchProfileInfoWithFallback(cleanUser: string, session: StealthSessionConfig | null | undefined, options: { jitter?: boolean } = {}): Promise<{ status: number; text: string; data?: any; deviceId?: string } | null> {
  const isUsable = (res: { status: number; data?: any } | null) =>
    Boolean(res && res.status !== 404 && res.status !== 429 && res.data?.status !== "fail" && res.data?.data?.user);

  const isAuthenticated = Boolean(session?.cookies?.sessionid);

  const tryHtml = () =>
    scrapeProfileHtml(cleanUser, (url) => htmlPageFetch(url, session));


  let htmlFirst: Awaited<ReturnType<typeof tryHtml>> = null;
  if (!isAuthenticated) {
    htmlFirst = await tryHtml();
    if (isUsable(htmlFirst)) return htmlFirst;
    if (htmlFirst && htmlFirst.status === 404) return htmlFirst;
    // Fall through: maybe the JSON API is reachable after all.
  }

  const primaryUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${cleanUser}`;
  const primary = await stealthRequestWithRetry(primaryUrl, {
    session,
    isAjax: true,
    referer: `https://www.instagram.com/${cleanUser}/`,
    jitter: options.jitter,
  });
  if (isUsable(primary)) return primary;

  const mobileUrl = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${cleanUser}`;
  const fallback = await stealthRequestWithRetry(mobileUrl, {
    session,
    isAjax: true,
    referer: `https://www.instagram.com/${cleanUser}/`,
    jitter: options.jitter,
  }, 1);
  if (isUsable(fallback)) return fallback;
  const proxyUrl = session?.proxyUrl || process.env.DEFAULT_PROXY_URL || undefined;
  const anonCookies = await bootstrapAnonymousCookies(proxyUrl);
  const mergedCookies: Record<string, string> = {
    ...anonCookies,
    ...(session?.cookies ?? {}),
  };
  const csrf = mergedCookies["csrftoken"] || "";

  const variables = JSON.stringify({
    username: cleanUser,
    "__relay_internal__pv__PolarisWebSchoolsEnabledrelayprovider": false,
    "enable_integrity_filters": true,
  });

  const postBody = new URLSearchParams({
    variables,
    doc_id: "27937681195819736",
    server_timestamps: "true",
  }).toString();

  const graphqlSession: StealthSessionConfig = {
    username: session?.username ?? "",
    cookies: mergedCookies,
    userAgent: session?.userAgent,
    proxyUrl: session?.proxyUrl,
    deviceId: session?.deviceId,
  };

  const graphqlRes = await stealthRequestWithRetry("https://www.instagram.com/graphql/query",  // no trailing slash — matches instaloader
    {
      session: graphqlSession,
      isAjax: true,
      referer: `https://www.instagram.com/${cleanUser}/`,
      jitter: options.jitter,
      postBody,
      extraHeaders: csrf ? { "x-csrftoken": csrf } : {},
    },
    1
  );

  if (graphqlRes && graphqlRes.status === 200) {
    const rawUser = graphqlRes.data?.data?.user ??
      graphqlRes.data?.user ??
      null;

    if (rawUser) {
      const normalised = {
        ...graphqlRes,
        data: {
          status: "ok",
          data: { user: rawUser },
        },
      };
      if (isUsable(normalised)) return normalised;
    }
  }

  // Authenticated callers reach the HTML page here, after their JSON attempts.
  const htmlRes = isAuthenticated ? await tryHtml() : null;

  if (htmlRes) {
    if (isUsable(htmlRes)) return htmlRes;
    if (htmlRes.status === 404 || htmlRes.status === 429 || htmlRes.status === LOGIN_SHELL_STATUS) {
      return htmlRes;
    }
  }
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
    const res = await fetchProfileInfoWithFallback(cleanUser, effectiveSession);
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
    return {
      username,
      externalId: null,
      accountType: "UNKNOWN" as const,
      eligibility: "TEMPORARILY_UNAVAILABLE" as const,
      capabilities: [] as CapabilityCheck[],
      errorCode: isProxyAuthFailed ? "PROXY_AUTH_FAILED" : "REQUEST_ERROR",
      errorMessage: isProxyAuthFailed
        ? "Proxy authentication failed (407). Check your DEFAULT_PROXY_URL credentials in .env — make sure you're using the Proxy Username/Password from Webshare's Connections tab, not your account email/password."
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

    if (true) {
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
): Promise<string[]> {
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
  return list;
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

  try {
    if (options?.humanSimEnabled) {
      await simulateHumanActions(effectiveSession);
    }

    const res = await fetchProfileInfoWithFallback(cleanUser, effectiveSession, { jitter: options?.jitterEnabled });
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
      const blockKind = await classifyBlock(effectiveSession);
      return {
        ok: false,
        notFound: blockKind === "not_blocked",
        sessionFlagged: blockKind === "session_flagged",
        rateLimited: blockKind === "rate_limited" || blockKind === "ip_blocked",
        errorMessage: blockKind === "session_flagged" ? isAuthenticated ? "Instagram checkpoint challenge required. Session needs re-authentication." : "Anonymous IP challenged by Instagram. Add a session to bypass." : blockKind === "not_blocked" ? `Target @${cleanUser} not found — account may have been deleted or renamed.` : "IP/session temporarily blocked. Will retry on next run.",
      };
    }

    const userData = res.data?.data?.user;
    if (!userData) {
      // Classify before giving up — don't flat-fail on a blocked IP
      const blockKind = await classifyBlock(effectiveSession);
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
    let followingList: string[] | undefined = undefined;
    if (isAuthenticated && options?.watchFollowerChurn && fetchedExternalId) {
      followersList = await fetchFriendshipIdList("followers", fetchedExternalId, cleanUser, session, options);
      followingList = await fetchFriendshipIdList("following", fetchedExternalId, cleanUser, session, options);
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
      media,
      stories,
      followersList,
      followingList,
      anonymousMode: !isAuthenticated,
      deviceId: res.deviceId,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isProxyAuthFailed = (err as any).isProxyAuthFailed || msg.startsWith("PROXY_AUTH_FAILED");
    return {
      ok: false,
      temporaryFailure: !isProxyAuthFailed,
      authError: isProxyAuthFailed,
      errorMessage: isProxyAuthFailed
        ? "Proxy authentication failed (407). Check your DEFAULT_PROXY_URL credentials in .env — use the Proxy Username/Password from Webshare's Connections tab."
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
