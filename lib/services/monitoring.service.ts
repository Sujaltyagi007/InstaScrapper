import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMetaProvider } from "@/lib/meta/provider-factory";
import { decryptSecret } from "@/lib/crypto";
import { hashProfile, detectProfileChanges, findNewMedia } from "./diff.service";
import { recordEvent } from "./event.service";
import { nextRunAtFromInterval, clampIntervalSeconds } from "./target.service";
import { pickSession, reportSessionOutcome } from "@/lib/meta/session-pool";
import type { TargetFetchResult } from "@/lib/meta/types";
import { uploadRemoteMediaToImageKit, isImageKitEnabled } from "@/lib/storage/imagekit";

type TargetWithMonitorAndSnapshot = Prisma.TargetGetPayload<{ include: { monitor: true; snapshots: { orderBy: { capturedAt: "desc" }; take: 1 } }; }>;
type TargetWithActiveMonitor = TargetWithMonitorAndSnapshot & {
  monitor: NonNullable<TargetWithMonitorAndSnapshot["monitor"]>;
};

const NOT_FOUND_CONFIRMATIONS_REQUIRED = 2;
const MAX_CONSECUTIVE_FAILURES_BEFORE_BACKOFF = 1;

function backoffSeconds(consecutiveFailures: number): number {
  const base = 60; // 1 minute
  return Math.min(base * 2 ** consecutiveFailures, 6 * 60 * 60); // cap at 6h
}

export async function runDueTargetChecks(limit = 20) {
  const due = await prisma.target.findMany({
    where: {
      status: { in: ["ACTIVE", "RATE_LIMITED", "BACKOFF"] },
      nextRunAt: { lte: new Date() },
    },
    take: limit,
    orderBy: { nextRunAt: "asc" },
  });

  const results = [];
  for (const target of due) {
    try {
      results.push(await processTarget(target.id));
    } catch (err) {
      // processTarget already records the failure (job + pushed-out nextRunAt) before
      // re-throwing; catching here just keeps one bad target from aborting the rest of the batch.
      results.push({
        targetId: target.id,
        outcome: "ERROR" as const,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { checked: results.length, results };
}

function calculateNextRunAt(
  monitor: {
    intervalSeconds: number;
    jitterEnabled?: boolean;
    restrictedHoursEnabled?: boolean;
    restrictedHoursStart?: number;
    restrictedHoursEnd?: number;
  }
): Date {
  let interval = clampIntervalSeconds(monitor.intervalSeconds);

  if (monitor.jitterEnabled) {
    const jitterFactor = Math.random() * 0.3 - 0.15; // -15% to +15%
    interval = Math.max(60, Math.round(interval * (1 + jitterFactor)));
  }

  const planned = new Date(Date.now() + interval * 1000);

  if (monitor.restrictedHoursEnabled) {
    const startHour = monitor.restrictedHoursStart ?? 8;
    const endHour = monitor.restrictedHoursEnd ?? 23;
    const currentHour = planned.getUTCHours();

    if (startHour <= endHour) {
      if (currentHour < startHour || currentHour > endHour) {
        planned.setUTCHours(startHour, Math.floor(Math.random() * 15), 0, 0);
        if (currentHour > endHour) {
          planned.setUTCDate(planned.getUTCDate() + 1);
        }
      }
    }
  }

  return planned;
}

export async function processTarget(targetId: string) {
  const job = await prisma.job.create({
    data: { type: "TARGET_CHECK", targetId, status: "RUNNING", startedAt: new Date() },
  });

  try {
    const target = await prisma.target.findUniqueOrThrow({
      where: { id: targetId },
      include: {
        monitor: { include: { instagramSession: true } },
        snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
      },
    });

    if (!target.monitor || !target.monitor.active) {
      await finishJob(job.id, "SUCCEEDED", "Skipped: monitor inactive");
      return { targetId, outcome: "SKIPPED_INACTIVE" as const };
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
      },
    });

    if (!fetchResult.ok) {
      return await handleFailedFetch(target as TargetWithActiveMonitor, fetchResult, job.id, usedSessionId);
    }

    return await handleSuccessfulFetch(target as TargetWithActiveMonitor, fetchResult, job.id, usedSessionId);
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
  usedSessionId: string | null = null
) {
  const now = new Date();
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
      let storageUrl: string | null = null;
      let storageFileId: string | null = null;

      if (isImageKitEnabled()) {
        const targetUrl = item.videoUrl || item.mediaUrl;
        if (targetUrl) {
          const ext = item.videoUrl ? "mp4" : "jpg";
          const res = await uploadRemoteMediaToImageKit({
            url: targetUrl,
            fileName: `${target.normalizedUsername}_${item.externalMediaId}.${ext}`,
            folder: `/instascrapper/targets/${target.normalizedUsername}/media`,
            tags: [target.normalizedUsername, item.mediaType],
          });
          if (res) {
            storageUrl = res.url;
            storageFileId = res.fileId;
          }
        }
      }

      await prisma.media.create({
        data: {
          targetId: target.id,
          externalMediaId: item.externalMediaId,
          mediaType: item.mediaType,
          permalink: item.permalink,
          timestamp: item.timestamp ? new Date(item.timestamp) : null,
          caption: item.caption,
          mediaUrl: storageUrl ?? item.mediaUrl,
          videoUrl: item.videoUrl,
          storageUrl,
          storageFileId,
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
              storageUrl,
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
                storageUrl,
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

        if (isImageKitEnabled()) {
          const targetUrl = story.videoUrl || story.mediaUrl;
          if (targetUrl) {
            const ext = story.videoUrl ? "mp4" : "jpg";
            const res = await uploadRemoteMediaToImageKit({
              url: targetUrl,
              fileName: `${target.normalizedUsername}_story_${story.externalMediaId}.${ext}`,
              folder: `/instascrapper/targets/${target.normalizedUsername}/stories`,
              tags: [target.normalizedUsername, "STORY"],
            });
            if (res) {
              storyStorageUrl = res.url;
              storyStorageFileId = res.fileId;
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

  // Upload profile picture if available & ImageKit is active
  let profilePicStorageUrl: string | null = null;
  let profilePicStorageId: string | null = null;
  if (isImageKitEnabled() && profile.profilePictureUrl) {
    const res = await uploadRemoteMediaToImageKit({
      url: profile.profilePictureUrl,
      fileName: `${target.normalizedUsername}_profile_${Date.now()}.jpg`,
      folder: `/instascrapper/targets/${target.normalizedUsername}/profile`,
      tags: [target.normalizedUsername, "PROFILE_PIC"],
    });
    if (res) {
      profilePicStorageUrl = res.url;
      profilePicStorageId = res.fileId;
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

  const nextRunAt = calculateNextRunAt(target.monitor);

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
