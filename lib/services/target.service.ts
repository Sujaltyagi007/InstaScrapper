import { prisma } from "@/lib/prisma";
import { deleteTargetFiles, syncStoredFiles } from "@/lib/services/storage-manager.service";
import { signToken, verifyToken } from "@/lib/security/signed-token";
import { reserveTargetSlot } from "@/lib/services/quota.service";
import { NotFoundError } from "@/lib/errors";
import { ApiError } from "@/lib/api-helpers";
import { getMetaProvider, getProviderMode } from "@/lib/meta/provider-factory";
import { getActiveGraphAccount } from "@/lib/services/meta-connection.service";
import { toPrismaAccountType, toPrismaEligibility, isMonitorable } from "@/lib/meta/capability.service";
import type { TargetResolution } from "@/lib/meta/types";

export function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}

const USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/;

export function validateUsernameFormat(username: string): { valid: boolean; reason?: string } {
  const normalized = normalizeUsername(username);
  if (!normalized) return { valid: false, reason: "Username is required." };
  if (!USERNAME_PATTERN.test(normalized)) {
    return { valid: false, reason: "Usernames may only contain letters, numbers, periods, and underscores." };
  }
  return { valid: true };
}

/**
 * Phase: "Backend resolves and validates the target" (plan section 1, step 4).
 *
 * `userId` is needed in GRAPH mode: Business Discovery is performed *as* the
 * user's own connected Instagram account, so the resolve can't happen without
 * it. Omitting it in GRAPH mode surfaces "connect your account" rather than a
 * confusing lookup failure.
 */
export async function resolveTargetUsername(
  username: string,
  session?: import("@/lib/meta/types").StealthSessionConfig | null,
  userId?: string,
): Promise<TargetResolution> {
  const format = validateUsernameFormat(username);
  if (!format.valid) {
    return {
      username: normalizeUsername(username),
      externalId: null,
      accountType: "UNKNOWN",
      eligibility: "UNSUPPORTED",
      capabilities: [],
      errorCode: "INVALID_USERNAME",
      errorMessage: format.reason,
    };
  }

  const provider = getMetaProvider();
  const graphAccount =
    getProviderMode() === "GRAPH" && userId ? await getActiveGraphAccount(userId) : null;
  return provider.resolveTarget(normalizeUsername(username), session, graphAccount);
}

/** How long a preview's lookup can be reused by the save step. */
const RESOLUTION_TOKEN_TTL_MS = 10 * 60_000;

/**
 * Signs a resolution for the browser to hand back on save, so adding a target
 * costs one Instagram lookup instead of two. Bound to the user and username;
 * any edit breaks the signature.
 */
export function signResolution(userId: string, resolution: TargetResolution): string | null {
  return signToken({ userId, username: resolution.username, resolution }, RESOLUTION_TOKEN_TTL_MS);
}

export function verifiedResolution(userId: string, username: string, token: string | null | undefined): TargetResolution | null {
  const payload = verifyToken<{ userId: string; username: string; resolution: TargetResolution }>(token);
  if (!payload || payload.userId !== userId) return null;
  return normalizeUsername(payload.username) === normalizeUsername(username) ? payload.resolution : null;
}

async function assertOwnsInstagramSession(userId: string, instagramSessionId: string | null | undefined) {
  if (!instagramSessionId) return;
  const owned = await prisma.instagramSession.findFirst({
    where: { id: instagramSessionId, userId },
    select: { id: true },
  });
  if (!owned) throw new NotFoundError("Instagram session not found.");
}

const MIN_INTERVAL_SECONDS = 300; // server-enforced safe minimum (plan section 14)

export function clampIntervalSeconds(requested: number): number {
  return Math.max(MIN_INTERVAL_SECONDS, Math.floor(requested));
}
export function nextRunAtFromInterval(intervalSeconds: number): Date {
  const stagger = Math.floor(Math.random() * 60_000);
  return new Date(Date.now() + intervalSeconds * 1000 + stagger);
}

export async function createTarget(params: {
  userId: string;
  username: string;
  resolution: TargetResolution;
  watchNewMedia: boolean;
  watchProfile: boolean;
  watchFollowerCount: boolean;
  watchFollowingCount: boolean;
  watchStories?: boolean;
  watchReels?: boolean;
  watchFollowerChurn?: boolean;
  watchCollabPosts?: boolean;
  jitterEnabled?: boolean;
  humanSimEnabled?: boolean;
  restrictedHoursEnabled?: boolean;
  restrictedHoursStart?: number;
  restrictedHoursEnd?: number;
  instagramSessionId?: string | null;
  engineType?: string;
  triggerMode?: string;
  purpose?: "MONITOR" | "TREND";
  followerThreshold?: number;
  intervalSeconds: number;
  notificationChannelIds: string[];
}) {
  const normalized = normalizeUsername(params.username);
  const monitorable = isMonitorable(params.resolution);
  const interval = clampIntervalSeconds(params.intervalSeconds);

  await assertOwnsInstagramSession(params.userId, params.instagramSessionId);

  // The quota is enforced here, at the one place targets are created, inside a
  // per-user lock — so every caller is covered and concurrent adds can't
  // overshoot the limit.
  return reserveTargetSlot(params.userId, (tx) => tx.target.create({
    data: {
      userId: params.userId,
      username: params.resolution.username,
      normalizedUsername: normalized,
      externalId: params.resolution.externalId,
      accountType: toPrismaAccountType(params.resolution.accountType),
      eligibility: toPrismaEligibility(params.resolution.eligibility),
      status: monitorable ? "ACTIVE" : "UNSUPPORTED",
      errorCode: params.resolution.errorCode,
      errorMessage: params.resolution.errorMessage,
      // Due immediately, NOT one interval out. Snapshots and media are only
      // written by a monitoring run, so deferring the first check left a new
      // target with no profile data and an empty media grid for a full
      // interval (the UI defaults to 90 minutes) — which reads as "the app
      // scraped nothing". The cron/dev poller picks this up on its next pass.
      nextRunAt: monitorable ? new Date() : null,
      monitor: {
        create: {
          userId: params.userId,
          engineType: params.engineType ?? "STEALTH_SCRAPER",
          triggerMode: params.triggerMode ?? "NEW_POSTS_ONLY",
          purpose: params.purpose ?? "MONITOR",
          watchNewMedia: params.watchNewMedia,
          watchProfile: params.watchProfile,
          watchFollowerCount: params.watchFollowerCount,
          watchFollowingCount: params.watchFollowingCount,
          watchStories: params.watchStories ?? true,
          watchReels: params.watchReels ?? true,
          watchFollowerChurn: params.watchFollowerChurn ?? false,
          watchCollabPosts: params.watchCollabPosts ?? true,
          jitterEnabled: params.jitterEnabled ?? true,
          humanSimEnabled: params.humanSimEnabled ?? false,
          restrictedHoursEnabled: params.restrictedHoursEnabled ?? false,
          restrictedHoursStart: params.restrictedHoursStart ?? 8,
          restrictedHoursEnd: params.restrictedHoursEnd ?? 23,
          instagramSessionId: params.instagramSessionId || null,
          followerThreshold: params.followerThreshold,
          intervalSeconds: interval,
          active: monitorable,
          notificationChannelIds: params.notificationChannelIds,
        },
      },
    },
    include: { monitor: true },
  }));
}

export async function listTargets(userId: string) {
  return prisma.target.findMany({
    where: { userId },
    include: {
      monitor: true,
      _count: { select: { events: true } },
      // Latest name + picture for the list's avatar.
      snapshots: {
        take: 1,
        orderBy: { capturedAt: "desc" },
        select: { name: true, profilePictureStorageUrl: true, followersCount: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getTargetDetail(userId: string, targetId: string) {
  return prisma.target.findFirst({
    where: { id: targetId, userId },
    include: {
      monitor: true,
      snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
      events: { orderBy: { detectedAt: "desc" }, take: 20 },
      // Anonymous scrapes only ever yield Instagram's 12 newest posts per
      // check (logged-out GraphQL pagination returns a null user, so the back
      // catalogue is unreachable without a session). Media therefore
      // accumulates slowly over many checks — capping at 24 was discarding
      // history we had already collected and made the grid look near-empty.
      media: { orderBy: [{ timestamp: "desc" }, { firstSeenAt: "desc" }], take: 120, include: { assets: { orderBy: { position: "asc" } } } },
    },
  });
}

export async function updateTargetMonitor(
  userId: string,
  targetId: string,
  updates: Partial<{
    watchNewMedia: boolean;
    watchProfile: boolean;
    watchFollowerCount: boolean;
    watchFollowingCount: boolean;
    watchStories: boolean;
    watchReels: boolean;
    watchFollowerChurn: boolean;
    watchCollabPosts: boolean;
    jitterEnabled: boolean;
    humanSimEnabled: boolean;
    restrictedHoursEnabled: boolean;
    restrictedHoursStart: number;
    restrictedHoursEnd: number;
    instagramSessionId: string | null;
    engineType: string;
    triggerMode: string;
    followerThreshold: number | null;
    intervalSeconds: number;
    active: boolean;
    notificationChannelIds: string[];
  }>
) {
  const target = await prisma.target.findFirst({ where: { id: targetId, userId } });
  if (!target) throw new NotFoundError("Target not found.");

  if (updates.instagramSessionId !== undefined) {
    await assertOwnsInstagramSession(userId, updates.instagramSessionId);
  }

  const data = { ...updates };
  if (data.intervalSeconds != null) {
    data.intervalSeconds = clampIntervalSeconds(data.intervalSeconds);
  }

  const monitor = await prisma.monitor.update({ where: { targetId }, data });

  // Pausing/resuming a target should be reflected in its status immediately.
  if (updates.active === false) {
    await prisma.target.update({ where: { id: targetId }, data: { status: "PAUSED", nextRunAt: null } });
  } else if (updates.active === true && target.status === "PAUSED") {
    await prisma.target.update({
      where: { id: targetId },
      data: {
        status: "ACTIVE",
        errorCode: null,
        errorMessage: null,
        nextRunAt: nextRunAtFromInterval(monitor.intervalSeconds),
      },
    });
  }

  return monitor;
}

/**
 * Deletes a target. With `deleteFiles`, its stored media, thumbnails, stories
 * and profile pictures are deleted too (the target stays if any file can't be
 * deleted, so nothing is left untracked). Without it the files stay in storage
 * and remain listed on the Storage page under the account's name.
 */
export async function deleteTarget(userId: string, targetId: string, opts: { deleteFiles?: boolean } = {}) {
  const target = await prisma.target.findFirst({ where: { id: targetId, userId } });
  if (!target) throw new NotFoundError("Target not found.");
  // Register every file first: files the register doesn't know about would be
  // impossible to find once the target's rows are gone.
  await syncStoredFiles(userId);
  if (opts.deleteFiles) {
    const { failed } = await deleteTargetFiles(userId, targetId);
    if (failed > 0) {
      throw new ApiError(502, `${failed} file(s) couldn't be deleted from storage, so the account was kept. Try again.`);
    }
  }
  await prisma.target.delete({ where: { id: targetId } });
}

export async function bulkSetTargetsActive(userId: string, targetIds: string[], active: boolean) {
  const results = await Promise.allSettled(
    targetIds.map((id) => updateTargetMonitor(userId, id, { active }))
  );
  return { count: results.filter((r) => r.status === "fulfilled").length, total: targetIds.length };
}

export async function bulkDeleteTargets(userId: string, targetIds: string[], opts: { deleteFiles?: boolean } = {}) {
  let count = 0;
  for (const id of targetIds) {
    try {
      await deleteTarget(userId, id, opts);
      count += 1;
    } catch (err) {
      console.warn(`[targets] bulk delete skipped ${id}:`, err instanceof Error ? err.message : err);
    }
  }
  return { count, total: targetIds.length };
}
