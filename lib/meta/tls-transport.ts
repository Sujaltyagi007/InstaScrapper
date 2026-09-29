import path from "path";
import { randomUUID } from "crypto";
import workerpool from "workerpool";
import { createRequire } from "node:module";

export interface TlsRawResponse {
  status: number;
  body: string;
  headers: Record<string, string[]>;
  cookies: Record<string, string>;
}

export interface TlsRequestParams {
  url: string;
  method?: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  bodyBytes?: Buffer;
  proxyUrl?: string | null;
  tlsClientIdentifier?: string;
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
    const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));
    const tlsEntry = nodeRequire.resolve("@dryft/tlsclient/lib/helpers/tls.js");
    pool = workerpool.pool(tlsEntry, {
      workerThreadOpts: { env: { TLS_LIB_PATH: resolveTlsLibPath() } },
    });
  }
  return pool;
}


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
