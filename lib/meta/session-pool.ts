import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import type { StealthSessionConfig } from "./types";

const POOL_CANDIDATE_LIMIT = 5;
const COOLDOWN_MINUTES = 15;

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
    proxyUrl: sessionRecord.proxyUrl,
    impersonateTarget: sessionRecord.impersonateTarget,
  };
}

export async function peekSession(
  userId: string,
  opts?: { pinnedSessionId?: string | null }
): Promise<PickedSession | null> {
  if (opts?.pinnedSessionId) {
    const pinned = await prisma.instagramSession.findFirst({
      where: {
        id: opts.pinnedSessionId,
        userId,
        status: "ACTIVE",
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
      },
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
    where: {
      userId,
      status: "ACTIVE",
      OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
    },
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
  if (opts?.pinnedSessionId) {
    const pinned = await prisma.instagramSession.findFirst({
      where: {
        id: opts.pinnedSessionId,
        userId,
        status: "ACTIVE",
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
      },
    });

    if (pinned) {
      const claimed = await prisma.instagramSession.updateMany({
        where: { id: pinned.id, lastUsedAt: pinned.lastUsedAt },
        data: { lastUsedAt: new Date() },
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
    where: {
      userId,
      status: "ACTIVE",
      OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
    },
    orderBy: { lastUsedAt: "asc" },
    take: POOL_CANDIDATE_LIMIT,
  });

  for (const candidate of candidates) {
    const claimed = await prisma.instagramSession.updateMany({
      where: { id: candidate.id, lastUsedAt: candidate.lastUsedAt },
      data: { lastUsedAt: new Date() },
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
          ...(outcome.deviceId ? { deviceId: outcome.deviceId } : {}),
        },
      });
    } else if (outcome.kind === "RATE_LIMITED") {
      await prisma.instagramSession.update({
        where: { id: sessionId },
        data: {
          cooldownUntil: new Date(now.getTime() + COOLDOWN_MINUTES * 60000),
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
