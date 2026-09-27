import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api-helpers";
import { policyFor } from "@/lib/access/roles";
import { can, type Actor } from "@/lib/access/permissions";
import { sendAccountAlert } from "@/lib/services/notification.service";

export type QuotaLevel = "OK" | "WARN" | "FULL";
export const TARGET_LIMIT_REACHED = "TARGET_LIMIT_REACHED";
export const TARGET_LIMIT_INVALID = "TARGET_LIMIT_INVALID";

type Db = Prisma.TransactionClient | typeof prisma;

export interface TargetQuota {
  used: number;
  limit: number;
  remaining: number;
  warnAt: number;
  level: QuotaLevel;
  minLimit: number;
  maxLimit: number;
  defaultLimit: number;
}

const LEVEL_RANK: Record<QuotaLevel, number> = { OK: 0, WARN: 1, FULL: 2 };

function levelFor(used: number, limit: number, warnAt: number): QuotaLevel {
  if (used >= limit) return "FULL";
  if (used >= warnAt) return "WARN";
  return "OK";
}

function normalizeStoredLevel(value: string | null): QuotaLevel {
  return value === "WARN" || value === "FULL" ? value : "OK";
}

export async function getTargetQuota(userId: string, db: Db = prisma): Promise<TargetQuota> {
  // Independent of each other, so one round trip instead of two in sequence.
  const [user, used] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true, maxTargets: true } }),
    db.target.count({ where: { userId } }),
  ]);
  const policy = policyFor(user.role).targets;

  // Clamp in case the stored value predates a policy change (e.g. a role's
  // maxLimit was lowered): the policy always wins over the stored number.
  const limit = Math.min(Math.max(user.maxTargets, policy.minLimit), policy.maxLimit);
  const warnAt = Math.max(1, Math.ceil(limit * policy.warnRatio));

  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    warnAt,
    level: levelFor(used, limit, warnAt),
    minLimit: policy.minLimit,
    maxLimit: policy.maxLimit,
    defaultLimit: policy.defaultLimit,
  };
}

function limitReachedError(quota: TargetQuota): ApiError {
  const atCeiling = quota.limit >= quota.maxLimit;
  return new ApiError(403, atCeiling
    ? `You're monitoring ${quota.used} of ${quota.limit} accounts, which is the maximum. Remove an account to add another.`
    : `You're monitoring ${quota.used} of ${quota.limit} accounts. Raise your limit in Settings (up to ${quota.maxLimit}) to add more.`,
    TARGET_LIMIT_REACHED, { used: quota.used, limit: quota.limit, maxLimit: quota.maxLimit, canRaise: !atCeiling }
  );
}

export async function assertCanAddTarget(userId: string): Promise<TargetQuota> {
  const quota = await getTargetQuota(userId);
  if (quota.used >= quota.limit) throw limitReachedError(quota);
  return quota;
}

export async function reserveTargetSlot<T>(userId: string, create: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`target-quota:${userId}`}))`;
    const quota = await getTargetQuota(userId, tx);
    if (quota.used >= quota.limit) throw limitReachedError(quota);
    return create(tx);
  });

  // Outside the transaction: alert delivery is network I/O and must not hold
  // the lock or be able to roll back a target that was created successfully.
  await syncTargetQuotaAlert(userId).catch((err) =>
    console.warn("[quota] alert sync failed:", err instanceof Error ? err.message : err)
  );

  return result;
}

/**
 * Changes a user's limit. Rejects values outside the role policy, and values
 * below current usage — silently pausing or deleting targets to fit would be
 * far more surprising than asking the user to remove some first.
 */
export async function updateTargetLimit(
  actor: Actor,
  subjectUserId: string,
  requestedLimit: number
): Promise<TargetQuota> {
  if (!can(actor, "targetLimit.update", subjectUserId)) {
    throw new ApiError(403, "You don't have permission to change this limit.");
  }

  const current = await getTargetQuota(subjectUserId);
  const limit = Math.floor(requestedLimit);

  if (!Number.isFinite(limit) || limit < current.minLimit || limit > current.maxLimit) {
    throw new ApiError(
      400,
      `Account limit must be between ${current.minLimit} and ${current.maxLimit}.`,
      TARGET_LIMIT_INVALID,
      { minLimit: current.minLimit, maxLimit: current.maxLimit }
    );
  }
  if (limit < current.used) {
    throw new ApiError(
      400,
      `You're monitoring ${current.used} accounts. Remove ${current.used - limit} before lowering the limit to ${limit}.`,
      TARGET_LIMIT_INVALID,
      { used: current.used, requested: limit }
    );
  }

  await prisma.user.update({ where: { id: subjectUserId }, data: { maxTargets: limit } });
  await syncTargetQuotaAlert(subjectUserId);
  return getTargetQuota(subjectUserId);
}

export async function syncTargetQuotaAlert(userId: string): Promise<void> {
  const [quota, user] = await Promise.all([
    getTargetQuota(userId),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { targetQuotaAlertLevel: true } }),
  ]);
  const previous = normalizeStoredLevel(user.targetQuotaAlertLevel);

  if (LEVEL_RANK[quota.level] === LEVEL_RANK[previous]) return;
  await prisma.user.update({
    where: { id: userId },
    data: { targetQuotaAlertLevel: quota.level === "OK" ? null : quota.level },
  });

  if (LEVEL_RANK[quota.level] < LEVEL_RANK[previous]) return; // went down: re-arm only

  const message = quota.level === "FULL" ? {
    kind: "TARGET_LIMIT_REACHED",
    title: "Account limit reached",
    body: quota.limit >= quota.maxLimit
      ? `You're monitoring ${quota.used} of ${quota.limit} accounts, the maximum allowed. Remove an account to add another.`
      : `You're monitoring ${quota.used} of ${quota.limit} accounts. Raise your limit in Settings (up to ${quota.maxLimit}) to add more.`,
  } : {
    kind: "TARGET_LIMIT_WARNING",
    title: "Approaching your account limit",
    body: `You're monitoring ${quota.used} of ${quota.limit} accounts (${quota.remaining} left).`,
  };

  await sendAccountAlert(userId, message);
}
