import path from "path";
import { randomUUID } from "crypto";
import { createRequire } from "node:module";

/**
 * Cookie-aware TLS transport.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS (read before touching):
 * The normal path — `createTLSClient()` (axios) in stealth-engine-bridge.ts —
 * keeps only the FIRST value of each response header (verified: an Instagram
 * response's `Set-Cookie` arrives as a single string holding just `csrftoken`;
 * `mid`/`datr`/`sessionid` are dropped). That is fine for scraping, but the
 * login flow MUST read every cookie Instagram sets, above all `sessionid`.
 *
 * The Go tls-client returns the full cookie jar as a top-level `cookies` field
 * in its raw JSON response. This module talks to that worker directly so it
 * can return that jar, while keeping the Chrome TLS/JA3 fingerprint (plain
 * Node fetch would expose a Node fingerprint, the worst signal on a login).
 *
 * ⚠️ BUNDLING (the trap brain.md warns about): an earlier attempt drove the
 * worker pool via a *computed-path* `require()` of an *undeclared* `workerpool`
 * — Next couldn't trace it and it crashed with MODULE_NOT_FOUND in production.
 * This version avoids that by:
 *   1. `workerpool` is now a declared dependency (package.json), and
 *   2. both `workerpool` and `@dryft/tlsclient` are in
 *      next.config.ts `serverExternalPackages` (loaded from node_modules at
 *      runtime, never bundled), and
 *   3. the requires below are STATIC bare specifiers, not computed paths.
 * Any change here must be re-verified with a real `next build`.
 */

// Static bare specifiers so Next's tracer + serverExternalPackages handle them.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import workerpool from "workerpool";

export interface TlsRawResponse {
  status: number;
  body: string;
  /** Response headers as the Go lib returns them (values are string[]). */
  headers: Record<string, string[]>;
  /** Full cookie jar after the response: name → value. Empty if none. */
  cookies: Record<string, string>;
}

export interface TlsRequestParams {
  url: string;
  method?: "GET" | "POST";
  headers: Record<string, string>;
  /** URL-encoded or JSON string body for POST. */
  body?: string;
  /**
   * Raw binary body (e.g. an image/video upload). Sent as base64 with
   * `isByteRequest`, which the Go tls-client decodes back to bytes. Takes
   * precedence over `body` when set.
   */
  bodyBytes?: Buffer;
  proxyUrl?: string | null;
  tlsClientIdentifier?: string;
  /**
   * Pins the cookie jar. Reuse the same id across a login's bootstrap →
   * submit so cookies set by the bootstrap are sent on the submit, exactly
   * like a browser. Omit for a throwaway jar.
   */
  sessionId?: string;
  followRedirects?: boolean;
  timeoutSeconds?: number;
}

function resolveTlsLibPath(): string {
  const nativeDir = path.join(process.cwd(), "lib", "native");
  if (process.platform === "win32") return path.join(nativeDir, "tls-client-windows-64-v1.7.2.dll");
  if (process.platform === "linux") return path.join(nativeDir, "tls-client-linux-ubuntu-amd64-v1.7.2.so");
  throw new Error(`No bundled tls-client binary for platform "${process.platform}".`);
}

let pool: workerpool.Pool | null = null;

function getPool(): workerpool.Pool {
  if (!pool) {
    // workerpool.pool() needs a REAL absolute disk path. Next virtualizes the
    // bundle's own `require.resolve` to an "[externals]/…" string that isn't a
    // path, so resolve through a runtime require anchored at the project root
    // instead — that returns the genuine node_modules file path.
    const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));
    const tlsEntry = nodeRequire.resolve("@dryft/tlsclient/lib/helpers/tls.js");
    pool = workerpool.pool(tlsEntry, {
      workerThreadOpts: { env: { TLS_LIB_PATH: resolveTlsLibPath() } },
    });
  }
  return pool;
}

/**
 * Performs one request and returns status, body, headers, AND the full cookie
 * jar. Use this only where cookies matter (login); scraping stays on the
 * lighter axios path in stealth-engine-bridge.ts.
 */
export async function tlsRequestRaw(params: TlsRequestParams): Promise<TlsRawResponse> {
  const payload = {
    tlsClientIdentifier: params.tlsClientIdentifier ?? "chrome_120",
    followRedirects: params.followRedirects ?? true,
    insecureSkipVerify: true,
    withoutCookieJar: false,
    withDefaultCookieJar: true,
    isByteRequest: params.bodyBytes !== undefined,
    catchPanics: false,
    withDebug: false,
    forceHttp1: false,
    withRandomTLSExtensionOrder: true,
    timeoutSeconds: params.timeoutSeconds ?? 30,
    timeoutMilliseconds: 0,
    sessionId: params.sessionId ?? `tls-${randomUUID()}`,
    isRotatingProxy: false,
    proxyUrl: params.proxyUrl || "",
    certificatePinningHosts: {},
    headers: params.headers,
    headerOrder: [],
    requestUrl: params.url,
    requestMethod: params.method ?? "GET",
    ...(params.bodyBytes !== undefined
      ? { requestBody: params.bodyBytes.toString("base64") }
      : params.body !== undefined
        ? { requestBody: params.body }
        : {}),
  };

  const raw = await getPool().exec("request", [JSON.stringify(payload)]);
  const res = JSON.parse(raw as string);

  if (res?.status === 407) {
    const err = new Error("PROXY_AUTH_FAILED: proxy rejected credentials (407)");
    (err as Error & { isProxyAuthFailed?: boolean }).isProxyAuthFailed = true;
    throw err;
  }

  const body = typeof res?.body === "object" ? JSON.stringify(res.body) : String(res?.body ?? "");
  const cookies: Record<string, string> =
    res?.cookies && typeof res.cookies === "object" ? res.cookies : {};

  return {
    status: Number(res?.status ?? 0),
    body,
    headers: res?.headers ?? {},
    cookies,
  };
}
