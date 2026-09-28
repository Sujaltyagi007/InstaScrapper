import { pickSession, reportSessionOutcome } from "@/lib/meta/session-pool";
import { stealthFetchUserFeed, type SessionVerdict } from "@/lib/meta/stealth-engine-bridge";
import type { NormalizedMediaItem } from "@/lib/meta/types";

/**
 * Fills in what a logged-out check can't see (a reel's real video file, every
 * item of a carousel) with ONE logged-in request, and only when the check found
 * posts that need it. The burner is claimed through the pool, so its daily cap,
 * cooldown and fixed proxy all apply; a warning from Instagram pauses it.
 */

export function needsLoggedInMedia(item: NormalizedMediaItem): boolean {
  if ((item.mediaType === "REEL" || item.mediaType === "VIDEO") && !item.videoUrl) return true;
  return item.mediaType === "CAROUSEL_ALBUM" && !item.children?.length;
}

/** Tells the pool what Instagram said about the account, so a warning stops it. */
export async function reportVerdict(sessionId: string, verdict: SessionVerdict, status: number): Promise<void> {
  if (verdict === "OK") await reportSessionOutcome(sessionId, { kind: "SUCCESS" });
  else if (verdict === "RATE_LIMITED") await reportSessionOutcome(sessionId, { kind: "RATE_LIMITED", message: `HTTP ${status}` });
  else if (verdict === "FLAGGED") await reportSessionOutcome(sessionId, { kind: "FLAGGED", message: `Instagram asked this account to verify (HTTP ${status})` });
}

export type EnrichmentOutcome =
  | { used: false; reason: "not_needed" | "no_profile_id" | "no_burner" }
  | { used: true; verdict: SessionVerdict; filled: number };

/**
 * Mutates `items` in place: adds videoUrl / children / REEL type from the
 * logged-in feed to the posts that need them.
 */
export async function enrichWithLoggedInFeed(
  userId: string,
  profileId: string | null,
  items: NormalizedMediaItem[],
): Promise<EnrichmentOutcome> {
  const pending = items.filter(needsLoggedInMedia);
  if (pending.length === 0) return { used: false, reason: "not_needed" };
  if (!profileId) return { used: false, reason: "no_profile_id" };

  const picked = await pickSession(userId);
  if (!picked) return { used: false, reason: "no_burner" };

  const lookup = await stealthFetchUserFeed(profileId, picked.config);
  await reportVerdict(picked.id, lookup.verdict, lookup.status);

  const byId = new Map(lookup.result.map((entry) => [entry.item.externalMediaId, entry.item]));
  let filled = 0;
  for (const item of pending) {
    const found = byId.get(item.externalMediaId);
    if (!found) continue;
    if (!item.videoUrl && found.videoUrl) item.videoUrl = found.videoUrl;
    if (!item.children?.length && found.children?.length) item.children = found.children;
    if (found.mediaType === "REEL") item.mediaType = "REEL";
    if (!needsLoggedInMedia(item)) filled += 1;
  }
  if (lookup.verdict !== "OK") {
    console.warn(`[enrich] burner lookup for profile ${profileId} returned ${lookup.verdict} (HTTP ${lookup.status})`);
  }
  return { used: true, verdict: lookup.verdict, filled };
}
