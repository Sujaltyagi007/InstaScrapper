import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-helpers";
import { policyFor } from "@/lib/access/roles";
import { can, type Actor } from "@/lib/access/permissions";
import { sendAccountAlert } from "@/lib/services/notification.service";

/**
 * Per-user target quota.
 * ---------------------------------------------------------------------------
 * Owns three things, and is the only module that does:
 *   1. reading usage vs. limit            (getTargetQuota)
 *   2. enforcing the limit on create      (reserveTargetSlot / assertCanAddTarget)
 *   3. changing the limit + alerting      (updateTargetLimit / syncTargetQuotaAlert)
 *
 * Limits come from the user's role policy (lib/access/roles.ts), and who may
 * change a limit comes from lib/access/permissions.ts. Nothing here branches
 * on a role name, so new roles need no changes in this file.
 *
 * Every target counts toward usage — active, paused and unsupported alike.
 */

export type QuotaLevel = "OK" | "WARN" | "FULL";

export const TARGET_LIMIT_REACHED = "TARGET_LIMIT_REACHED";
export const TARGET_LIMIT_INVALID = "TARGET_LIMIT_INVALID";

type Db = Prisma.TransactionClient | typeof prisma;

export interface TargetQuota {
  used: number;
  limit: number;
  remaining: number;
  /** Usage at which the "almost full" warning starts. */
  warnAt: number;
  level: QuotaLevel;
  /** Bounds this user may set their own limit within. */
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
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true, maxTargets: true },
  });
  const policy = policyFor(user.role).targets;

  // Clamp in case the stored value predates a policy change (e.g. a role's
  // maxLimit was lowered): the policy always wins over the stored number.
  const limit = Math.min(Math.max(user.maxTargets, policy.minLimit), policy.maxLimit);
  const used = await db.target.count({ where: { userId } });
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
  return new ApiError(
    403,
    atCeiling
      ? `You're monitoring ${quota.used} of ${quota.limit} accounts, which is the maximum. Remove an account to add another.`
      : `You're monitoring ${quota.used} of ${quota.limit} accounts. Raise your limit in Settings (up to ${quota.maxLimit}) to add more.`,
    TARGET_LIMIT_REACHED,
    { used: quota.used, limit: quota.limit, maxLimit: quota.maxLimit, canRaise: !atCeiling }
  );
}

/**
 * Cheap early check, run BEFORE the slow Instagram lookup so a user at the
 * limit is told immediately instead of after a ~30s resolve. Not authoritative
 * on its own — two concurrent requests can both pass it — so creation still
 * goes through reserveTargetSlot().
 */
export async function assertCanAddTarget(userId: string): Promise<TargetQuota> {
  const quota = await getTargetQuota(userId);
  if (quota.used >= quota.limit) throw limitReachedError(quota);
  return quota;
}

/**
 * Authoritative enforcement: runs `create` inside a transaction that holds a
 * per-user advisory lock while it re-counts, so concurrent adds are serialized
 * and a user at 9/10 can't end up at 11/10 by submitting twice at once.
 *
 * The lock is transaction-scoped (released on commit/rollback) and keyed on
 * the user id, so it never blocks other users.
 */
export async function reserveTargetSlot<T>(
  userId: string,
  create: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
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

/**
 * Sends a channel alert when usage crosses UP into a new level (OK→WARN,
 * WARN→FULL), at most once per crossing.
 *
 * The last level alerted is stored on the user. It is also lowered whenever
 * usage drops (a target was deleted, or the limit was raised), which re-arms
 * the alert — so this needs no hooks in the delete paths: the next call
 * simply notices the level went down and resets it.
 */
export async function syncTargetQuotaAlert(userId: string): Promise<void> {
  const [quota, user] = await Promise.all([
    getTargetQuota(userId),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { targetQuotaAlertLevel: true } }),
  ]);
  const previous = normalizeStoredLevel(user.targetQuotaAlertLevel);

  if (LEVEL_RANK[quota.level] === LEVEL_RANK[previous]) return;

  // Persist first. If delivery then fails we won't retry-spam on every add;
  // the in-app banner still shows the state regardless.
  await prisma.user.update({
    where: { id: userId },
    data: { targetQuotaAlertLevel: quota.level === "OK" ? null : quota.level },
  });

  if (LEVEL_RANK[quota.level] < LEVEL_RANK[previous]) return; // went down: re-arm only

  const message =
    quota.level === "FULL"
      ? {
        kind: "TARGET_LIMIT_REACHED",
        title: "Account limit reached",
        body:
          quota.limit >= quota.maxLimit
            ? `You're monitoring ${quota.used} of ${quota.limit} accounts, the maximum allowed. Remove an account to add another.`
            : `You're monitoring ${quota.used} of ${quota.limit} accounts. Raise your limit in Settings (up to ${quota.maxLimit}) to add more.`,
      }
      : {
        kind: "TARGET_LIMIT_WARNING",
        title: "Approaching your account limit",
        body: `You're monitoring ${quota.used} of ${quota.limit} accounts (${quota.remaining} left).`,
      };

  await sendAccountAlert(userId, message);
}
