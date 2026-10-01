/**
 * One cheap, read-only request per provider to tell whether a key works before
 * it's saved. Model listings and 1-result searches cost no quota (or almost none).
 *
 *   ok          → the key works
 *   invalid     → the provider rejected the key (wrong, revoked, no access)
 *   limited     → the key is real but out of quota / rate-limited right now
 *   unreachable → couldn't tell (network, timeout, provider error); not the key's fault
 */
import type { KeyProvider } from "./key-detect";

export type KeyCheck =
  | { result: "ok" }
  | { result: "invalid"; message: string }
  | { result: "limited"; message: string }
  | { result: "unreachable"; message: string };

const TIMEOUT_MS = 10_000;

function request(provider: KeyProvider, key: string): { url: string; headers?: Record<string, string> } {
  const q = encodeURIComponent(key);
  switch (provider) {
    case "gemini":
      return { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", headers: { "x-goog-api-key": key } };
    case "openai":
      return { url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${key}` } };
    case "anthropic":
      return { url: "https://api.anthropic.com/v1/models?limit=1", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } };
    case "openrouter":
      return { url: "https://openrouter.ai/api/v1/key", headers: { Authorization: `Bearer ${key}` } };
    case "groq":
      return { url: "https://api.groq.com/openai/v1/models", headers: { Authorization: `Bearer ${key}` } };
    case "xai":
      return { url: "https://api.x.ai/v1/models", headers: { Authorization: `Bearer ${key}` } };
    case "pexels":
      return { url: "https://api.pexels.com/v1/curated?per_page=1", headers: { Authorization: key } };
    case "pixabay":
      return { url: `https://pixabay.com/api/?key=${q}&q=sky&per_page=3` };
    case "freesound":
      return { url: `https://freesound.org/apiv2/search/text/?query=rain&page_size=1&token=${q}` };
    case "europeana":
      return { url: `https://api.europeana.eu/record/v2/search.json?wskey=${q}&query=sky&rows=1` };
  }
}

function shortMessage(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string; message?: string; detail?: string };
    const err = typeof body.error === "string" ? body.error : body.error?.message;
    return (err ?? body.message ?? body.detail ?? text).toString().slice(0, 200);
  } catch {
    return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  }
}

/** True when an error response means the key itself is bad (vs. quota or a hiccup). */
export function looksLikeInvalidKey(status: number, message: string): boolean {
  if (status === 401) return true;
  if (status === 403) return !/quota|rate|limit|billing/i.test(message);
  // Gemini answers a bad key with 400 "API key not valid" / API_KEY_INVALID.
  if (status === 400) return /api[ _]?key/i.test(message) && /invalid|not valid|expired/i.test(message);
  return false;
}

export async function verifyKey(provider: KeyProvider, key: string): Promise<KeyCheck> {
  const { url, headers } = request(provider, key);
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    text = await res.text();
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return { result: "unreachable", message: timedOut ? "The provider didn't answer in time." : "Couldn't reach the provider." };
  }
  if (res.ok) return { result: "ok" };
  const message = shortMessage(text);
  if (res.status === 429) return { result: "limited", message: message || "Out of quota right now." };
  if (looksLikeInvalidKey(res.status, message)) return { result: "invalid", message: message || "The provider rejected this key." };
  return { result: "unreachable", message: `${res.status}: ${message}` };
}
