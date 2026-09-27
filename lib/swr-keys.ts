/**
 * SWR cache keys, shared between "use client" hooks and Server Component
 * pages. This file deliberately has NO "use client" directive.
 *
 * ⚠️ Trap this fixes: a "use client" file's exports all become opaque client
 * references when imported from a Server Component — including plain string
 * constants, not just components. Using one as a computed object key (e.g.
 * `{ [TARGETS_KEY]: data }` inside `SWRConfig`'s `fallback`) silently coerces
 * it to a throwing stub function's *stringified source* instead of the real
 * string, so the fallback key never matches what the client hook reads and
 * the page falls back to a normal client fetch — no error, just wrong data.
 * (Caught by logging `Object.keys(fallback)` and seeing that stub text.)
 * Keeping these keys in a plain module sidesteps it entirely.
 */
export const TARGETS_KEY = "/api/targets";
export const TARGET_QUOTA_KEY = "/api/account/quota";
export const EVENTS_KEY = "/api/events";
export const META_STATUS_KEY = "/api/meta/status";

export function targetDetailKey(targetId: string) {
  return `/api/targets/${targetId}`;
}
