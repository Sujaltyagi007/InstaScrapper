import crypto from "crypto";
import type { Monitor, TargetSnapshot, EventType } from "@prisma/client";
import type { NormalizedProfile, NormalizedMediaItem } from "@/lib/meta/types";

// `type` is the full EventType enum (not just the subset this file's diffing
// logic produces) so that monitoring.service.ts can also use this shape for
// out-of-band events like RATE_LIMITED / ACCOUNT_UNAVAILABLE that aren't the
// result of a profile/media diff.
export interface DetectedChange {
  type: EventType;
  fingerprint: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export function hashProfile(profile: NormalizedProfile): string {
  return crypto.createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

/**
 * Compares a freshly fetched profile against the last stored snapshot and
 * this target's known media, and returns the set of domain-level changes
 * per plan section 13 (Change Detection Rules). Returns [] when nothing
 * meaningful changed - a snapshot with an unchanged hash never produces an
 * event on its own.
 */
export function detectProfileChanges(
  monitor: Pick<
    Monitor,
    | "watchProfile"
    | "watchFollowerCount"
    | "watchFollowingCount"
    | "followerThreshold"
  > & {
    watchReels?: boolean;
    watchStories?: boolean;
  },
  previous: TargetSnapshot | null,
  next: NormalizedProfile
): DetectedChange[] {
  const changes: DetectedChange[] = [];
  if (!previous) return changes; // first observation establishes baseline only

  if (monitor.watchProfile) {
    const fieldsChanged: Record<string, { before: unknown; after: unknown }> = {};
    const fields: Array<keyof NormalizedProfile> = ["name", "biography", "website", "profilePictureUrl"];
    for (const field of fields) {
      const beforeVal = normalizeForCompare(previous[field as keyof TargetSnapshot]);
      const afterVal = normalizeForCompare(next[field]);
      if (beforeVal !== afterVal) {
        fieldsChanged[field] = { before: previous[field as keyof TargetSnapshot], after: next[field] };
      }
    }
    if (Object.keys(fieldsChanged).length > 0) {
      changes.push({
        type: "PROFILE_CHANGED",
        fingerprint: crypto.createHash("sha256").update(JSON.stringify(fieldsChanged)).digest("hex"),
        before: fieldsChanged,
        after: null,
      });
    }
  }

  if (monitor.watchFollowerCount && previous.followersCount != null && next.followersCount != null) {
    const delta = Math.abs(next.followersCount - previous.followersCount);
    const threshold = monitor.followerThreshold ?? 0;
    if (next.followersCount !== previous.followersCount && delta >= threshold) {
      changes.push({
        type: "FOLLOWER_COUNT_CHANGED",
        fingerprint: `followers_${previous.id}_${next.followersCount}`,
        before: { followersCount: previous.followersCount },
        after: { followersCount: next.followersCount },
      });
    }
  }

  if (monitor.watchFollowingCount && previous.followsCount != null && next.followsCount != null) {
    if (next.followsCount !== previous.followsCount) {
      changes.push({
        type: "FOLLOWING_COUNT_CHANGED",
        fingerprint: `following_${previous.id}_${next.followsCount}`,
        before: { followsCount: previous.followsCount },
        after: { followsCount: next.followsCount },
      });
    }
  }

  if (monitor.watchReels && next.reelsCount != null && previous.reelsCount != null) {
    if (next.reelsCount !== previous.reelsCount) {
      changes.push({
        type: "NEW_REEL",
        fingerprint: `reels_${previous.id}_${next.reelsCount}`,
        before: { reelsCount: previous.reelsCount },
        after: { reelsCount: next.reelsCount },
      });
    }
  }

  return changes;
}

function normalizeForCompare(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

/** externalMediaId values not already present in `knownMediaIds`. */
export function findNewMedia(
  media: NormalizedMediaItem[],
  knownMediaIds: Set<string>
): NormalizedMediaItem[] {
  return media.filter((m) => !knownMediaIds.has(m.externalMediaId));
}
