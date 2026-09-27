
/**
 * "facebook" = Facebook Login tokens (graph.facebook.com).
 * "instagram" = Instagram Login tokens (graph.instagram.com). A token only works
 * on the host that issued it.
 */
export type GraphHost = "facebook" | "instagram";

export interface GraphRequestOptions {
  host?: GraphHost;
}

export function graphApiVersion(): string {
  return process.env.META_GRAPH_API_VERSION || "v21.0";
}

export function instagramApiVersion(): string {
  return process.env.INSTAGRAM_GRAPH_API_VERSION || "v25.0";
}

export function graphBaseUrl(host: GraphHost = "facebook"): string {
  return host === "instagram"
    ? `https://graph.instagram.com/${instagramApiVersion()}`
    : `https://graph.facebook.com/${graphApiVersion()}`;
}

export class GraphApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number,
    public readonly type?: string,
  ) {
    super(message);
    this.name = "GraphApiError";
  }
}

/** GET a Graph API path with query params. Throws GraphApiError on failure. */
export async function graphGet<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  options: GraphRequestOptions = {},
): Promise<T> {
  const url = new URL(`${graphBaseUrl(options.host)}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url.toString(), { method: "GET" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new GraphApiError(err.message || `Graph API GET ${path} failed (${res.status})`, res.status, err.code, err.type);
  }
  return body as T;
}

/** POST to a Graph API path with a form body. Throws GraphApiError on failure. */
export async function graphPost<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  options: GraphRequestOptions = {},
): Promise<T> {
  const url = new URL(`${graphBaseUrl(options.host)}${path}`);
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) form.set(key, String(value));
  }
  const res = await fetch(url.toString(), { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new GraphApiError(err.message || `Graph API POST ${path} failed (${res.status})`, res.status, err.code, err.type);
  }
  return body as T;
}
