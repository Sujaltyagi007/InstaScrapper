import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMetaProvider } from "@/lib/meta/provider-factory";
import { decryptSecret } from "@/lib/crypto";
import { hashProfile, detectProfileChanges, findNewMedia } from "./diff.service";
import { recordEvent } from "./event.service";
import { nextRunAtFromInterval, clampIntervalSeconds } from "./target.service";
import { pickSession, reportSessionOutcome } from "@/lib/meta/session-pool";
import type { TargetFetchResult } from "@/lib/meta/types";
import { uploadHeavyAndThumbnail } from "@/lib/services/media-storage.service";
import { isStorageEnabled, fetchToBuffer, uploadBuffer } from "@/lib/storage";
import { getPacingGate, reserveProfileView, recordCheckOutcome } from "./pacing.service";
import {
  humanIntervalSeconds,
  isInWindow,
  nextActiveTime,
  nextAwakeTime,
  randomBetween,
  safeTimeZone,
} from "@/lib/scheduling/time-windows";

const SLEEP_FIELDS = { timezone: true, sleepEnabled: true, sleepStartHour: true, sleepEndHour: true } as const;
type UserSleepSettings = Prisma.UserGetPayload<{ select: typeof SLEEP_FIELDS }>;

type TargetWithMonitorAndSnapshot = Prisma.TargetGetPayload<{
  include: {
    monitor: true;
    snapshots: { orderBy: { capturedAt: "desc" }; take: 1 };
    user: { select: typeof SLEEP_FIELDS };
  };
}>;
type TargetWithActiveMonitor = TargetWithMonitorAndSnapshot & {
  monitor: NonNullable<TargetWithMonitorAndSnapshot["monitor"]>;
};

const NOT_FOUND_CONFIRMATIONS_REQUIRED = 2;
const MAX_CONSECUTIVE_FAILURES_BEFORE_BACKOFF = 1;

function backoffSeconds(consecutiveFailures: number): number {
  const base = 60; // 1 minute
  return Math.min(base * 2 ** consecutiveFailures, 6 * 60 * 60); // cap at 6h
}

/**
 * Time budget for one scheduler invocation. Vercel Hobby kills functions at
 * ~60s; 45s leaves room for DB writes and uploads after the last check.
 */
export const DEFAULT_RUN_BUDGET_MS = 45_000;
/** Don't start a check with less time than this left — it would be cut short. */
const MIN_TIME_TO_START_MS = 20_000;
/** How long a claimed target stays locked if a run dies without releasing it. */
const CHECK_LEASE_MS = 5 * 60 * 1000;

export type RunStopReason = "NO_DUE_TARGETS" | "TIME_BUDGET" | "MAX_CHECKS" | "PAUSED" | "DAILY_LIMIT";

export interface RunOptions {
  /** Total wall-clock budget for this invocation, in ms. */
  budgetMs?: number;
  /** Upper bound on real (non-skipped) checks in one invocation. */
  maxChecks?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isSkipped(outcome: string): boolean {
  return outcome.startsWith("SKIPPED_");
}

/**
 * Human-paced scheduler. Checks due targets ONE AT A TIME with random pauses
 * between them, stops starting new work once the time budget runs low, and
 * respects the app-wide daily cap and circuit breaker (pacing.service).
 *
 * It deliberately does less per call than it could: callers (cron, GitHub
 * Actions, dev poller) invoke it every few minutes, so work spreads out over
 * time instead of arriving as a burst — which is both what a person browsing
 * looks like and what keeps the proxy IP from getting hot.
 */
export async function runDueTargetChecks(options: RunOptions = {}) {
  const budgetMs = options.budgetMs ?? DEFAULT_RUN_BUDGET_MS;
  const maxChecks = options.maxChecks ?? 5;
  const startedAt = Date.now();
  const deadlineAt = startedAt + budgetMs;

  const results: Array<{ targetId: string; outcome: string; error?: string }> = [];
  const attempted = new Set<string>();
  let realChecks = 0;
  let stopReason: RunStopReason = "NO_DUE_TARGETS";

  while (true) {
    if (realChecks >= maxChecks) { stopReason = "MAX_CHECKS"; break; }
    if (deadlineAt - Date.now() < MIN_TIME_TO_START_MS) { stopReason = "TIME_BUDGET"; break; }

    const gate = await getPacingGate();
    if (!gate.ok) { stopReason = gate.reason; break; }

    const candidate = await pickNextDueTarget(attempted);
    if (!candidate) { stopReason = "NO_DUE_TARGETS"; break; }
    // Never retry the same target within one run — a target that returns a
    // skip (e.g. inactive) would otherwise be picked again forever.
    attempted.add(candidate);

    // A person doesn't open profiles back-to-back. Pause only between real
    // checks, and never let the pause eat the time needed for the next one.
    if (realChecks > 0) {
      const pauseMs = randomBetween(3_000, 15_000);
      if (deadlineAt - Date.now() - pauseMs < MIN_TIME_TO_START_MS) { stopReason = "TIME_BUDGET"; break; }
      await sleep(pauseMs);
    }

    try {
      const result = await processTarget(candidate, { deadlineAt, scheduled: true });
      results.push(result);
      if (result.outcome === "SKIPPED_DAILY_LIMIT") { stopReason = "DAILY_LIMIT"; break; }
      if (!isSkipped(result.outcome)) realChecks++;
    } catch (err) {
      // processTarget already recorded the failure (job + pushed-out
      // nextRunAt) before re-throwing; one bad target mustn't stop the run.
      realChecks++;
      results.push({
        targetId: candidate,
        outcome: "ERROR",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    checked: realChecks,
    results,
    stopReason,
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * Next due, unlocked target not yet attempted in this run. Targets whose
 * owner is inside their sleep window are pushed to wake-up time (plus a random
 * spread, so mornings don't start with a burst) instead of being checked.
 */
async function pickNextDueTarget(exclude: Set<string>): Promise<string | null> {
  // Bounded: each pass either returns a target or defers a batch of sleeping ones.
  for (let pass = 0; pass < 5; pass++) {
    const now = new Date();
    const due = await prisma.target.findMany({
      where: {
        status: { in: ["ACTIVE", "RATE_LIMITED", "BACKOFF"] },
        nextRunAt: { lte: now },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
        ...(exclude.size ? { id: { notIn: [...exclude] } } : {}),
      },
      orderBy: { nextRunAt: "asc" },
      take: 10,
      select: { id: true, nextRunAt: true, user: { select: SLEEP_FIELDS } },
    });
    if (due.length === 0) return null;

    for (const t of due) {
      const wakeAt = deferForSleep(now, t.user);
      if (wakeAt.getTime() === now.getTime()) return t.id;

      // Guarded on the nextRunAt we read, so a concurrent change isn't clobbered.
      await prisma.target.updateMany({
        where: { id: t.id, nextRunAt: t.nextRunAt },
        data: { nextRunAt: wakeAt },
      });
    }
  }
  return null;
}

/**
 * If `at` falls inside the user's sleep window, returns wake-up time plus a
 * 0–45 min spread; otherwise returns `at` unchanged.
 */
export function deferForSleep(at: Date, user: UserSleepSettings): Date {
  if (!user.sleepEnabled) return at;
  const tz = safeTimeZone(user.timezone);
  if (!isInWindow(at, tz, user.sleepStartHour, user.sleepEndHour)) return at;
  const awake = nextAwakeTime(at, tz, user.sleepStartHour, user.sleepEndHour);
  return new Date(awake.getTime() + randomBetween(0, 45) * 60 * 1000);
}

function calculateNextRunAt(
  monitor: {
    intervalSeconds: number;
    jitterEnabled?: boolean;
    restrictedHoursEnabled?: boolean;
    restrictedHoursStart?: number;
    restrictedHoursEnd?: number;
  },
  user: UserSleepSettings
): Date {
  const base = clampIntervalSeconds(monitor.intervalSeconds);
  // "jitterEnabled" now means human-like gaps: usually near the interval,
  // occasionally much longer. Clamped so it never drops below the safe minimum.
  const seconds = monitor.jitterEnabled ? clampIntervalSeconds(humanIntervalSeconds(base, 0)) : base;
  let planned = new Date(Date.now() + seconds * 1000);
  const tz = safeTimeZone(user.timezone);

  // Per-target active hours, in the user's own timezone (was UTC) and allowed
  // to wrap midnight (was unsupported). The end hour stays inclusive, as
  // before: 8–23 means checks may run 08:00–23:59.
  if (monitor.restrictedHoursEnabled) {
    const start = monitor.restrictedHoursStart ?? 8;
    const endExclusive = ((monitor.restrictedHoursEnd ?? 23) + 1) % 24;
    const active = nextActiveTime(planned, tz, start, endExclusive);
    if (active.getTime() !== planned.getTime()) {
      planned = new Date(active.getTime() + randomBetween(0, 20) * 60 * 1000);
    }
  }

  return deferForSleep(planned, user);
}

export interface ProcessTargetOptions {
  /** Epoch ms by which this check must finish (scheduled runs). */
  deadlineAt?: number;
  /**
   * True for scheduler-driven checks: enforces the app-wide daily cap. A user
   * clicking "Run check now" is counted but never refused.
   */
  scheduled?: boolean;
}

/**
 * Runs one check for a target, holding a lease so overlapping schedulers
 * (cron, GitHub Actions, dev poller, "Run check now") can never scrape the
 * same account at the same time. The lease is claimed atomically and released
 * only if still ours; if the process dies it simply expires.
 */
export async function processTarget(targetId: string, options: ProcessTargetOptions = {}) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + CHECK_LEASE_MS);
  const claim = await prisma.target.updateMany({
    where: { id: targetId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: leaseUntil },
  });
  if (claim.count === 0) {
    return { targetId, outcome: "SKIPPED_BUSY" as const };
  }

  try {
    const result = await runClaimedCheck(targetId, options);
    await recordCheckOutcome(result.outcome).catch((err) =>
      console.warn("[pacing] failed to record outcome:", err instanceof Error ? err.message : err)
    );
    return result;
  } finally {
    await prisma.target
      .updateMany({ where: { id: targetId, lockedUntil: leaseUntil }, data: { lockedUntil: null } })
      .catch(() => undefined);
  }
}

async function runClaimedCheck(targetId: string, options: ProcessTargetOptions) {
  const job = await prisma.job.create({
    data: { type: "TARGET_CHECK", targetId, status: "RUNNING", startedAt: new Date() },
  });

  try {
    const target = await prisma.target.findUniqueOrThrow({
      where: { id: targetId },
      include: {
        monitor: { include: { instagramSession: true } },
        snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
        user: { select: SLEEP_FIELDS },
      },
    });

    if (!target.monitor || !target.monitor.active) {
      await finishJob(job.id, "SUCCEEDED", "Skipped: monitor inactive");
      return { targetId, outcome: "SKIPPED_INACTIVE" as const };
    }

    // Count this profile view against the app-wide daily cap. Scheduled runs
    // are refused once it's reached; manual checks are counted but allowed.
    const viewAllowed = await reserveProfileView({ enforce: Boolean(options.scheduled) });
    if (!viewAllowed) {
      await finishJob(job.id, "SUCCEEDED", "Skipped: daily profile-view limit reached");
      return { targetId, outcome: "SKIPPED_DAILY_LIMIT" as const };
    }

    const isStealth = (target.monitor.engineType ?? "STEALTH_SCRAPER") === "STEALTH_SCRAPER";

    let sessionConfig = null;
    let accessToken = "";
    let usedSessionId: string | null = null;

    if (isStealth) {
      const picked = await pickSession(target.userId, { pinnedSessionId: target.monitor.instagramSessionId });
      if (picked) {
        usedSessionId = picked.id;
        sessionConfig = picked.config;
      }
    } else {
      // Official Meta Graph API mode requires active MetaConnection
      const connection = await prisma.metaConnection.findFirst({
        where: { userId: target.userId, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
      });

      if (!connection) {
        await prisma.target.update({
          where: { id: target.id },
          data: { status: "REAUTH_REQUIRED", nextRunAt: null, lastCheckedAt: new Date() },
        });
        await finishJob(job.id, "FAILED", "No active Meta connection");
        return { targetId, outcome: "REAUTH_REQUIRED" as const };
      }

      accessToken = decryptSecret({
        ciphertext: connection.encryptedAccessToken,
        iv: connection.encryptedTokenIv,
      });
    }

    const provider = getMetaProvider();
    const fetchResult = await provider.fetchTargetData({
      username: target.normalizedUsername,
      externalId: target.externalId,
      accessToken,
      session: sessionConfig,
      options: {
        watchStories: target.monitor.watchStories,
        watchReels: target.monitor.watchReels,
        watchFollowerChurn: target.monitor.watchFollowerChurn,
        watchCollabPosts: target.monitor.watchCollabPosts,
        jitterEnabled: target.monitor.jitterEnabled,
        humanSimEnabled: target.monitor.humanSimEnabled,
        proxyUrl: sessionConfig?.proxyUrl,
        deadlineAt: options.deadlineAt,
      },
    });

    if (!fetchResult.ok) {
      return await handleFailedFetch(target as TargetWithActiveMonitor, fetchResult, job.id, usedSessionId);
    }

    return await handleSuccessfulFetch(
      target as TargetWithActiveMonitor,
      fetchResult,
      job.id,
      usedSessionId,
      options.deadlineAt
    );
  } catch (err) {
    await finishJob(job.id, "FAILED", err instanceof Error ? err.message : String(err));
    // Best-effort: push the target's next attempt out so a persistent bug doesn't hot-loop the scheduler.
    await prisma.target
      .update({ where: { id: targetId }, data: { nextRunAt: nextRunAtFromInterval(900) } })
      .catch(() => undefined);
    throw err;
  }
}

async function handleFailedFetch(
  target: TargetWithActiveMonitor,
  fetchResult: Pick<
    TargetFetchResult,
    | "rateLimited"
    | "temporaryFailure"
    | "notFound"
    | "authError"
    | "sessionFlagged"
    | "errorMessage"
  >,
  jobId: string,
  usedSessionId: string | null = null
) {
  const now = new Date();

  if (fetchResult.sessionFlagged) {
    if (usedSessionId) {
      await reportSessionOutcome(usedSessionId, { kind: "FLAGGED", message: fetchResult.errorMessage });
    }

    const otherEligible = await prisma.instagramSession.count({
      where: {
        userId: target.userId,
        status: "ACTIVE",
        id: { not: usedSessionId ?? undefined },
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: now } }],
      },
    });

    if (otherEligible > 0) {
      await prisma.target.update({
        where: { id: target.id },
        data: {
          status: "BACKOFF",
          consecutiveFailures: target.consecutiveFailures + 1,
          lastCheckedAt: now,
          errorCode: "SESSION_FLAGGED",
          errorMessage: fetchResult.errorMessage ?? "Session account or IP is flagged by Instagram.",
          nextRunAt: new Date(now.getTime() + 5 * 60000), // Retry in 5 minutes with next pool session
        },
      });
    } else {
      await prisma.target.update({
        where: { id: target.id },
        data: {
          status: "PAUSED",
          consecutiveFailures: target.consecutiveFailures + 1,
          lastCheckedAt: now,
          errorCode: "SESSION_FLAGGED",
          errorMessage: fetchResult.errorMessage ?? "Session account or IP is flagged by Instagram.",
          nextRunAt: null,
        },
      });
    }

    await recordEvent({
      targetId: target.id,
      userId: target.userId,
      change: {
        type: "SESSION_FLAGGED",
        fingerprint: `flagged_${target.id}_${now.toISOString().slice(0, 10)}`,
        before: null,
        after: { message: fetchResult.errorMessage ?? "Session flagged" },
      },
    });
    await finishJob(jobId, "FAILED", "Session flagged by Instagram");
    return { targetId: target.id, outcome: "SESSION_FLAGGED" as const };
  }

  if (fetchResult.rateLimited) {
    if (usedSessionId) {
      await reportSessionOutcome(usedSessionId, { kind: "RATE_LIMITED", message: fetchResult.errorMessage });
    }
    const failures = target.consecutiveFailures + 1;
    await prisma.target.update({
      where: { id: target.id },
      data: {
        status: "RATE_LIMITED",
        consecutiveFailures: failures,
        lastCheckedAt: now,
        errorCode: "RATE_LIMITED",
        errorMessage: fetchResult.errorMessage ?? "Rate limited by upstream API.",
        nextRunAt: new Date(now.getTime() + backoffSeconds(failures) * 1000),
      },
    });
    await recordRateLimitEvent(target.id, target.userId);
    await finishJob(jobId, "SUCCEEDED", "Rate limited");
    return { targetId: target.id, outcome: "RATE_LIMITED" as const };
  }

  if (fetchResult.authError) {
    await prisma.metaConnection.updateMany({
      where: { userId: target.userId, status: "ACTIVE" },
      data: { status: "REAUTH_REQUIRED" },
    });
    await prisma.target.update({
      where: { id: target.id },
      data: { status: "REAUTH_REQUIRED", nextRunAt: null, lastCheckedAt: now, errorCode: "AUTH_ERROR" },
    });
    await finishJob(jobId, "FAILED", "Auth error - reauthorization required");
    return { targetId: target.id, outcome: "AUTH_ERROR" as const };
  }

  if (fetchResult.notFound) {
    const failures = target.consecutiveFailures + 1;
    const confirmed = failures >= NOT_FOUND_CONFIRMATIONS_REQUIRED;
    await prisma.target.update({
      where: { id: target.id },
      data: {
        status: confirmed ? "NOT_FOUND" : target.status,
        consecutiveFailures: failures,
        lastCheckedAt: now,
        errorCode: "NOT_FOUND",
        errorMessage: fetchResult.errorMessage ?? "Account not found.",
        nextRunAt: confirmed ? null : new Date(now.getTime() + backoffSeconds(failures) * 1000),
      },
    });
    if (confirmed) {
      await recordEvent({
        targetId: target.id,
        userId: target.userId,
        change: {
          type: "ACCOUNT_UNAVAILABLE",
          fingerprint: `unavailable_${target.id}_${now.toISOString().slice(0, 10)}`,
          before: null,
          after: { errorCode: "NOT_FOUND" },
        },
      });
    }
    await finishJob(jobId, "SUCCEEDED", confirmed ? "Confirmed unavailable" : "Not found (unconfirmed)");
    return { targetId: target.id, outcome: confirmed ? ("UNAVAILABLE" as const) : ("TRANSIENT_NOT_FOUND" as const) };
  }

  // Generic temporary failure.
  const failures = target.consecutiveFailures + 1;
  await prisma.target.update({
    where: { id: target.id },
    data: {
      status: failures > MAX_CONSECUTIVE_FAILURES_BEFORE_BACKOFF ? "BACKOFF" : target.status,
      consecutiveFailures: failures,
      lastCheckedAt: now,
      errorCode: "TEMPORARY_FAILURE",
      errorMessage: fetchResult.errorMessage ?? "Temporary upstream failure.",
      nextRunAt: new Date(now.getTime() + backoffSeconds(failures) * 1000),
    },
  });
  await finishJob(jobId, "SUCCEEDED", "Temporary failure, backing off");
  return { targetId: target.id, outcome: "TEMPORARY_FAILURE" as const };
}

async function recordRateLimitEvent(targetId: string, userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  await recordEvent({
    targetId,
    userId,
    change: {
      type: "RATE_LIMITED",
      fingerprint: `ratelimit_${targetId}_${today}`,
      before: null,
      after: null,
    },
  });
}

async function handleSuccessfulFetch(
  target: TargetWithActiveMonitor,
  fetchResult: TargetFetchResult,
  jobId: string,
  usedSessionId: string | null = null,
  deadlineAt?: number
) {
  const now = new Date();
  // Uploads are the slow tail of a check. Near the deadline, still record the
  // media rows (so dedupe and events stay correct) but skip storing files;
  // the UI falls back to the source URL.
  const hasTimeToUpload = () => !deadlineAt || deadlineAt - Date.now() > 8_000;
  const profile = fetchResult.profile!;
  const media = fetchResult.media ?? [];
  const stories = fetchResult.stories ?? [];
  const previousSnapshot = target.snapshots[0] ?? null;
  const rawHash = hashProfile(profile);

  let eventsCreated = 0;

  // Media: dedupe by externalMediaId.
  if (target.monitor.watchNewMedia && media.length > 0) {
    const known = await prisma.media.findMany({
      where: { targetId: target.id, isStory: false },
      select: { externalMediaId: true },
    });
    const knownIds = new Set(known.map((m) => m.externalMediaId));
    const newItems = findNewMedia(media, knownIds);

    for (const item of newItems) {
      // Upload the full-resolution file plus an independently-stored
      // compressed thumbnail. The thumbnail is what keeps the feed rendering
      // after the 48h policy deletes the heavy original.
      const sourceUrl = item.videoUrl || item.mediaUrl;
      const stored = sourceUrl && hasTimeToUpload()
        ? await uploadHeavyAndThumbnail({
          sourceUrl,
          fileNameBase: `${target.normalizedUsername}_${item.externalMediaId}`,
          folder: `/instascrapper/targets/${target.normalizedUsername}/media`,
          tags: [target.normalizedUsername, item.mediaType],
          isVideo: Boolean(item.videoUrl),
        })
        : null;

      await prisma.media.create({
        data: {
          targetId: target.id,
          externalMediaId: item.externalMediaId,
          mediaType: item.mediaType,
          permalink: item.permalink,
          timestamp: item.timestamp ? new Date(item.timestamp) : null,
          caption: item.caption,
          // Display URLs: prefer storage, fall back to the live source.
          mediaUrl: stored?.storageUrl ?? item.mediaUrl,
          videoUrl: item.videoUrl,
          // Original upstream links, preserved verbatim for re-download.
          // Previously `mediaUrl` was overwritten with the storage URL, which
          // destroyed the only pointer back to the source.
          sourceMediaUrl: item.mediaUrl,
          sourceVideoUrl: item.videoUrl,
          storageUrl: stored?.storageUrl ?? null,
          storageFileId: stored?.storageFileId ?? null,
          storedAt: stored?.storedAt ?? null,
          thumbnailUrl: stored?.thumbnailUrl ?? null,
          thumbnailFileId: stored?.thumbnailFileId ?? null,
          isStory: false,
          isCollab: item.isCollab ?? false,
          collaborators: item.collaborators ?? [],
        },
      });
      if (previousSnapshot) {
        await recordEvent({
          targetId: target.id,
          userId: target.userId,
          change: {
            type: "NEW_MEDIA",
            fingerprint: `media_${target.id}_${item.externalMediaId}`,
            before: null,
            after: {
              ...item,
              storageUrl: stored?.storageUrl ?? null,
            } as unknown as Record<string, unknown>,
          },
        });
        eventsCreated++;

        // Collab post — content leaked through a public co-author.
        // instagram_monitor.py fires a dedicated alert for this because it
        // means a private account's content is visible without following them.
        if (item.isCollab && item.collaborators && item.collaborators.length > 0) {
          await recordEvent({
            targetId: target.id,
            userId: target.userId,
            change: {
              type: "COLLAB_POST_LEAKED",
              fingerprint: `collab_${target.id}_${item.externalMediaId}`,
              before: null,
              after: {
                externalMediaId: item.externalMediaId,
                permalink: item.permalink,
                mediaType: item.mediaType,
                collaborators: item.collaborators,
                storageUrl: stored?.storageUrl ?? null,
              } as unknown as Record<string, unknown>,
            },
          });
          eventsCreated++;
        }
      }
    }
  }

  // Stories
  if (target.monitor.watchStories && stories.length > 0) {
    const knownStories = await prisma.media.findMany({
      where: { targetId: target.id, isStory: true },
      select: { externalMediaId: true },
    });
    const knownStoryIds = new Set(knownStories.map((m) => m.externalMediaId));

    for (const story of stories) {
      if (!knownStoryIds.has(story.externalMediaId)) {
        let storyStorageUrl: string | null = null;
        let storyStorageFileId: string | null = null;

        if (isStorageEnabled() && hasTimeToUpload()) {
          const targetUrl = story.videoUrl || story.mediaUrl;
          if (targetUrl) {
            const ext = story.videoUrl ? "mp4" : "jpg";
            const buffer = await fetchToBuffer(targetUrl);
            if (buffer) {
              const res = await uploadBuffer({
                buffer,
                fileName: `${target.normalizedUsername}_story_${story.externalMediaId}.${ext}`,
                folder: `/instascrapper/targets/${target.normalizedUsername}/stories`,
                contentType: story.videoUrl ? "video/mp4" : "image/jpeg",
              });
              if (res) {
                storyStorageUrl = res.url;
                storyStorageFileId = res.fileId;
              }
            }
          }
        }

        await prisma.media.create({
          data: {
            targetId: target.id,
            externalMediaId: story.externalMediaId,
            mediaType: story.mediaType,
            permalink: story.permalink,
            timestamp: story.timestamp ? new Date(story.timestamp) : null,
            caption: story.caption,
            mediaUrl: storyStorageUrl ?? story.mediaUrl,
            videoUrl: story.videoUrl,
            storageUrl: storyStorageUrl,
            storageFileId: storyStorageFileId,
            isStory: true,
          },
        });
        if (previousSnapshot) {
          await recordEvent({
            targetId: target.id,
            userId: target.userId,
            change: {
              type: "NEW_STORY",
              fingerprint: `story_${target.id}_${story.externalMediaId}`,
              before: null,
              after: {
                ...story,
                storageUrl: storyStorageUrl,
              } as unknown as Record<string, unknown>,
            },
          });
          eventsCreated++;
        }
      }
    }
  }

  // Follower & following churn — diffs the raw ID lists fetched this run
  // against the lists stored on the previous snapshot (the bridge only
  // returns lists at all when watchFollowerChurn is on and the session is
  // authenticated; anonymous/unwatched runs skip this block entirely).
  if (target.monitor.watchFollowerChurn && (fetchResult.followersList || fetchResult.followingList)) {
    const prevFollowers = new Set((previousSnapshot?.followersListJson as string[] | null) ?? []);
    const prevFollowing = new Set((previousSnapshot?.followingListJson as string[] | null) ?? []);
    const currFollowers = fetchResult.followersList ?? [];
    const currFollowing = fetchResult.followingList ?? [];
    const currFollowersSet = new Set(currFollowers);
    const currFollowingSet = new Set(currFollowing);

    const followersAdded = currFollowers.filter((id) => !prevFollowers.has(id));
    const followersRemoved = [...prevFollowers].filter((id) => !currFollowersSet.has(id));
    const followingAdded = currFollowing.filter((id) => !prevFollowing.has(id));
    const followingRemoved = [...prevFollowing].filter((id) => !currFollowingSet.has(id));

    const hasChurn =
      followersAdded.length > 0 || followersRemoved.length > 0 || followingAdded.length > 0 || followingRemoved.length > 0;

    if (previousSnapshot && hasChurn) {
      await recordEvent({
        targetId: target.id,
        userId: target.userId,
        change: {
          type: "FOLLOWER_CHURN",
          fingerprint: `churn_${target.id}_${now.toISOString().slice(0, 13)}`,
          before: null,
          after: { followersAdded, followersRemoved, followingAdded, followingRemoved },
        },
      });
      eventsCreated++;
    }
  }

  // Profile / follower / following diffing.
  const changes = detectProfileChanges(target.monitor, previousSnapshot, profile);
  for (const change of changes) {
    await recordEvent({ targetId: target.id, userId: target.userId, change });
    eventsCreated++;
  }

  // Upload profile picture if storage is configured
  let profilePicStorageUrl: string | null = null;
  let profilePicStorageId: string | null = null;
  if (isStorageEnabled() && hasTimeToUpload() && profile.profilePictureUrl) {
    const buffer = await fetchToBuffer(profile.profilePictureUrl);
    if (buffer) {
      const res = await uploadBuffer({
        buffer,
        fileName: `${target.normalizedUsername}_profile_${Date.now()}.jpg`,
        folder: `/instascrapper/targets/${target.normalizedUsername}/profile`,
        contentType: "image/jpeg",
      });
      if (res) {
        profilePicStorageUrl = res.url;
        profilePicStorageId = res.fileId;
      }
    }
  }

  await prisma.targetSnapshot.create({
    data: {
      targetId: target.id,
      username: profile.username,
      name: profile.name,
      biography: profile.biography,
      website: profile.website,
      profilePictureUrl: profilePicStorageUrl ?? profile.profilePictureUrl,
      profilePictureStorageUrl: profilePicStorageUrl,
      profilePictureStorageId: profilePicStorageId,
      followersCount: profile.followersCount,
      followsCount: profile.followsCount,
      mediaCount: profile.mediaCount,
      reelsCount: profile.reelsCount ?? null,
      hasStory: profile.hasStory ?? false,
      storiesCount: profile.storiesCount ?? null,
      latestMediaId: media[0]?.externalMediaId ?? null,
      latestMediaTimestamp: media[0]?.timestamp ? new Date(media[0].timestamp) : null,
      followersListJson: fetchResult.followersList ?? undefined,
      followingListJson: fetchResult.followingList ?? undefined,
      rawHash,
    },
  });

  const nextRunAt = calculateNextRunAt(target.monitor, target.user);

  if (usedSessionId) {
    await reportSessionOutcome(usedSessionId, { kind: "SUCCESS", deviceId: fetchResult.deviceId });
  }

  await prisma.target.update({
    where: { id: target.id },
    data: {
      status: "ACTIVE",
      consecutiveFailures: 0,
      lastCheckedAt: now,
      lastSuccessAt: now,
      errorCode: null,
      errorMessage: null,
      nextRunAt,
    },
  });

  await finishJob(jobId, "SUCCEEDED", `${eventsCreated} event(s) created`);
  return { targetId: target.id, outcome: "OK" as const, eventsCreated };
}

async function finishJob(jobId: string, status: "SUCCEEDED" | "FAILED", summary: string) {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status,
      finishedAt: new Date(),
      resultSummary: summary,
      lastError: status === "FAILED" ? summary : null,
    },
  });
}
