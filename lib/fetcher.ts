export class FetchError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Stable error code from ApiError (e.g. TARGET_LIMIT_REACHED), if any. */
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new FetchError(
      data.error ?? `Request failed with status ${res.status}`,
      res.status,
      typeof data.code === "string" ? data.code : undefined,
      data.details && typeof data.details === "object" ? data.details : undefined
    );
  }
  return data as T;
}
