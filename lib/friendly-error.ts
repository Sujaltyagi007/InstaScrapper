import { FetchError } from "@/lib/fetcher";

/** Messages that are internal/technical and should never be shown to a user as-is. */
const TECHNICAL = /internal server error|request failed with status|prisma|ECONN|ETIMEDOUT|ENOTFOUND|socket|stack|\bat \w+ \(|unexpected token|json|undefined|null is not|cannot read/i;

function readable(message: string | undefined): message is string {
  return !!message && message.length <= 160 && !TECHNICAL.test(message);
}

/**
 * Turns any thrown error into a short sentence a user can act on. Messages our
 * own API wrote on purpose (ApiError: "Account limit reached.", "Instagram served
 * its login page, try again shortly.") are kept; anything technical, a crash, or
 * a dropped connection becomes plain language instead.
 */
export function friendlyError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You're offline. Check your connection and try again.";
  }
  if (err instanceof FetchError) {
    const { status, message } = err;
    if (status === 401) return "Your session has expired. Please sign in again.";
    if (readable(message)) return message;
    if (status === 403) return "You don't have access to this.";
    if (status === 404) return "We couldn't find that. It may have been removed.";
    if (status === 408 || status === 504) return "That took too long. Please try again.";
    if (status === 429) return "Too many requests. Wait a moment and try again.";
    if (status >= 500) return "Something went wrong on our side. Please try again in a moment.";
    return fallback;
  }
  // fetch() rejects with a TypeError when the network request itself fails.
  if (err instanceof TypeError) return "Couldn't reach the server. Check your connection and try again.";
  if (err instanceof Error && readable(err.message)) return err.message;
  return fallback;
}
