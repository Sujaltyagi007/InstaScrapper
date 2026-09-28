import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import type { StealthSessionConfig } from "./types";
import { assignStickyProxy, isRotatingProxy } from "./proxy-identity";
import { decryptProxyUrl, encryptProxyUrl } from "./proxy-secret";

const POOL_CANDIDATE_LIMIT = 5;

/**
 * Stop on the first warning. A "try again later" / 429 used to pause a burner
 * for 15 minutes, after which it went straight back to the same requests; an
 * account Instagram has just limited needs hours of silence, not minutes.
 */
const COOLDOWN_HOURS = Number(process.env.SESSION_COOLDOWN_HOURS ?? 6);

/**
 * Most logged-in uses one burner may make per UTC day (a check or a single
 * lookup each). Instagram judges automation by volume per account, so a hard
 * cap keeps a burner inside what one person scrolling would do.
 */
export function sessionDailyLimit(): number {
  const n = Number(process.env.SESSION_DAILY_LIMIT ?? 40);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 40;
}

function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Starts a fresh daily count for this user's burners whose count is from an earlier day. */
async function rollDailyCounts(userId: string): Promise<void> {
  const today = utcDay();
  await prisma.instagramSession.updateMany({
    where: { userId, OR: [{ usesDay: null }, { usesDay: { not: today } }] },
    data: { usesDay: today, usesToday: 0 },
  });
}

/**
 * When the soonest active burner can be used again (after its rest, or after
 * the UTC day rolls over if it hit today's cap). Null when none is active.
 */
export async function nextSessionAvailableAt(userId: string): Promise<Date | null> {
  const sessions = await prisma.instagramSession.findMany({
    where: { userId, status: "ACTIVE" },
    select: { cooldownUntil: true, usesToday: true, usesDay: true },
  });
  const now = Date.now();
  const tomorrow = new Date(`${utcDay()}T00:00:00.000Z`).getTime() + 86_400_000;
  let soonest: number | null = null;
  for (const s of sessions) {
    let at = now;
    if (s.cooldownUntil && s.cooldownUntil.getTime() > at) at = s.cooldownUntil.getTime();
    if (s.usesDay === utcDay() && s.usesToday >= sessionDailyLimit()) at = Math.max(at, tomorrow);
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest === null ? null : new Date(soonest);
}

/** Where-clause for a burner that may be used right now: active, not cooling down, under today's cap. */
function usableNow() {
  return {
    status: "ACTIVE",
    OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
    usesToday: { lt: sessionDailyLimit() },
  };
}

export type PickedSession = {
  id: string;
  config: StealthSessionConfig;
};

function buildSessionConfig(sessionRecord: any): StealthSessionConfig {
  const decryptedCookiesJson = decryptSecret({
    ciphertext: sessionRecord.encryptedCookies,
    iv: sessionRecord.encryptedCookiesIv,
  });
  const rawParsed = JSON.parse(decryptedCookiesJson);
  const cookies = (rawParsed && typeof rawParsed === "object" ? rawParsed : {}) as Record<string, string>;

  return {
    username: sessionRecord.username,
    cookies,
    userAgent: sessionRecord.userAgent,
    deviceId: sessionRecord.deviceId,
    proxyUrl: decryptProxyUrl(sessionRecord),
    impersonateTarget: sessionRecord.impersonateTarget,
    transport: sessionRecord.transport,
    homeWorkerDeviceId: sessionRecord.homeWorkerDeviceId,
    sessionId: sessionRecord.id,
  };
}

/**
 * Gives every burner of this user a fixed proxy before it's used. Sessions
 * saved before that rule existed (no proxy, or the rotating one) would
 * otherwise log in from this server's own connection or hop IPs per request.
 * A session that can't get a fixed proxy is paused rather than used unsafely.
 */
async function pinSessionProxies(userId: string): Promise<void> {
  const sessions = await prisma.instagramSession.findMany({
    where: { userId, status: "ACTIVE" },
    select: { id: true, proxyUrl: true, proxyUrlIv: true },
  });
  for (const session of sessions) {
    const current = decryptProxyUrl(session);
    if (current && !isRotatingProxy(current)) continue;
    const sticky = (await assignStickyProxy(session.id)) ?? null;
    const fallback = process.env.DEFAULT_PROXY_URL?.trim();
    const fixed = sticky ?? (fallback && !isRotatingProxy(fallback) ? fallback : null);
    await prisma.instagramSession.update({
      where: { id: session.id },
      data: fixed ? encryptProxyUrl(fixed) : { status: "PAUSED" },
    });
  }
}

export async function peekSession(userId: string, opts?: { pinnedSessionId?: string | null }): Promise<PickedSession | null> {
  await pinSessionProxies(userId);
  await rollDailyCounts(userId);
  if (opts?.pinnedSessionId) {
    const pinned = await prisma.instagramSession.findFirst({
      where: { id: opts.pinnedSessionId, userId, ...usableNow() },
    });
    if (pinned) {
      try {
        return { id: pinned.id, config: buildSessionConfig(pinned) };
      } catch {
        // proceed to pool rotation
      }
    }
  }

  const candidate = await prisma.instagramSession.findFirst({
    where: { userId, ...usableNow() },
    orderBy: { lastUsedAt: "asc" },
  });

  if (candidate) {
    try {
      return { id: candidate.id, config: buildSessionConfig(candidate) };
    } catch {
      // ignore
    }
  }
  return null;
}

export async function pickSession(
  userId: string,
  opts?: { pinnedSessionId?: string | null }
): Promise<PickedSession | null> {
  await pinSessionProxies(userId);
  await rollDailyCounts(userId);
  if (opts?.pinnedSessionId) {
    const pinned = await prisma.instagramSession.findFirst({
      where: { id: opts.pinnedSessionId, userId, ...usableNow() },
    });

    if (pinned) {
      // The cap is re-checked in the claim itself, so two concurrent claims
      // can't both take the last use of the day.
      const claimed = await prisma.instagramSession.updateMany({
        where: { id: pinned.id, lastUsedAt: pinned.lastUsedAt, usesToday: { lt: sessionDailyLimit() } },
        data: { lastUsedAt: new Date(), usesToday: { increment: 1 } },
      });
      if (claimed.count === 1) {
        try {
          return { id: pinned.id, config: buildSessionConfig(pinned) };
        } catch {
          // proceed to pool rotation
        }
      }
    }
  }

  const candidates = await prisma.instagramSession.findMany({
    where: { userId, ...usableNow() },
    orderBy: { lastUsedAt: "asc" },
    take: POOL_CANDIDATE_LIMIT,
  });

  for (const candidate of candidates) {
    const claimed = await prisma.instagramSession.updateMany({
      where: { id: candidate.id, lastUsedAt: candidate.lastUsedAt, usesToday: { lt: sessionDailyLimit() } },
      data: { lastUsedAt: new Date(), usesToday: { increment: 1 } },
    });

    if (claimed.count === 1) {
      try {
        return { id: candidate.id, config: buildSessionConfig(candidate) };
      } catch {
        // try next candidate
      }
    }
  }

  return null;
}

export async function reportSessionOutcome(
  sessionId: string,
  outcome: { kind: "SUCCESS" | "FLAGGED" | "RATE_LIMITED"; message?: string; deviceId?: string }
): Promise<void> {
  try {
    const now = new Date();
    if (outcome.kind === "SUCCESS") {
      await prisma.instagramSession.update({
        where: { id: sessionId },
        data: {
          lastSuccessAt: now,
          cooldownUntil: null,
          lastErrorMessage: null,
          ...(outcome.deviceId ? { deviceId: outcome.deviceId } : {}),
        },
      });
    } else if (outcome.kind === "RATE_LIMITED") {
      await prisma.instagramSession.update({
        where: { id: sessionId },
        data: {
          cooldownUntil: new Date(now.getTime() + COOLDOWN_HOURS * 3600000),
          lastErrorMessage: `Paused ${COOLDOWN_HOURS}h after Instagram limited it: ${outcome.message ?? "rate limited"}`,
        },
      });
    } else if (outcome.kind === "FLAGGED") {
      await prisma.instagramSession.update({
        where: { id: sessionId },
        data: {
          status: "FLAGGED",
          lastErrorMessage: outcome.message ?? "Flagged by Instagram",
        },
      });
    }
  } catch {
    // Fire-and-forget
  }
}
