import { prisma } from "@/lib/prisma";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS_PER_WINDOW = 10;
const BLOCK_DURATION_MS = 15 * 60 * 1000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * Simple DB-backed fixed-window rate limiter for sensitive unauthenticated
 * endpoints (login, register). No Redis dependency, consistent with the
 * chosen cron/scheduling approach for this deployment.
 */
export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  const now = new Date();
  const existing = await prisma.authRateLimit.findUnique({ where: { key } });

  if (existing?.blockedUntil && existing.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((existing.blockedUntil.getTime() - now.getTime()) / 1000),
    };
  }

  if (!existing || now.getTime() - existing.windowStart.getTime() > WINDOW_MS) {
    await prisma.authRateLimit.upsert({
      where: { key },
      create: { key, attempts: 1, windowStart: now },
      update: { attempts: 1, windowStart: now, blockedUntil: null },
    });
    return { allowed: true };
  }

  const attempts = existing.attempts + 1;
  if (attempts > MAX_ATTEMPTS_PER_WINDOW) {
    const blockedUntil = new Date(now.getTime() + BLOCK_DURATION_MS);
    await prisma.authRateLimit.update({ where: { key }, data: { attempts, blockedUntil } });
    return { allowed: false, retryAfterSeconds: Math.ceil(BLOCK_DURATION_MS / 1000) };
  }

  await prisma.authRateLimit.update({ where: { key }, data: { attempts } });
  return { allowed: true };
}

export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") || "unknown";
}
