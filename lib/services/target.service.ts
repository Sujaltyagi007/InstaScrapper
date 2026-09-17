import { prisma } from "@/lib/prisma";
import { reserveTargetSlot } from "@/lib/services/quota.service";
import { NotFoundError } from "@/lib/errors";
import { getMetaProvider } from "@/lib/meta/provider-factory";
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

/** Phase: "Backend resolves and validates the target" (plan section 1, step 4). */
export async function resolveTargetUsername(username: string, session?: import("@/lib/meta/types").StealthSessionConfig | null): Promise<TargetResolution> {
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
  return provider.resolveTarget(normalizeUsername(username), session);
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
    include: { monitor: true, _count: { select: { events: true } } },
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
      media: { orderBy: [{ timestamp: "desc" }, { firstSeenAt: "desc" }], take: 120 },
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

export async function deleteTarget(userId: string, targetId: string) {
  const target = await prisma.target.findFirst({ where: { id: targetId, userId } });
  if (!target) throw new NotFoundError("Target not found.");
  await prisma.target.delete({ where: { id: targetId } });
}

export async function bulkSetTargetsActive(userId: string, targetIds: string[], active: boolean) {
  const results = await Promise.allSettled(
    targetIds.map((id) => updateTargetMonitor(userId, id, { active }))
  );
  return { count: results.filter((r) => r.status === "fulfilled").length, total: targetIds.length };
}

export async function bulkDeleteTargets(userId: string, targetIds: string[]) {
  const result = await prisma.target.deleteMany({ where: { id: { in: targetIds }, userId } });
  return { count: result.count, total: targetIds.length };
}
