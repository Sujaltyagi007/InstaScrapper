import { prisma } from "@/lib/prisma";

const GLOBAL_KEY = "global";
const SOFT_FAIL_THRESHOLD = 3;
const BASE_PAUSE_MS = 15 * 60 * 1000; // 15 min, doubling: 15m, 30m, 1h, 2h, 4h
const MAX_PAUSE_MS = 4 * 60 * 60 * 1000;

export function dailyProfileViewLimit(): number {
  const raw = Number(process.env.SCRAPE_DAILY_LIMIT);
  return Number.isInteger(raw) && raw > 0 ? raw : 300;
}

function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Ensures the row exists and rolls the counter over on a new UTC day. */
async function ensureCurrentDay(key: string): Promise<void> {
  const today = utcDay();
  await prisma.$executeRaw`
    INSERT INTO scrape_throttle (id, day, "profileViews", "consecutiveSoftFails", "pauseLevel", "updatedAt")
    VALUES (${key}, ${today}, 0, 0, 0, NOW())
    ON CONFLICT (id) DO UPDATE
      SET day = EXCLUDED.day,
          "profileViews" = CASE WHEN scrape_throttle.day = EXCLUDED.day THEN scrape_throttle."profileViews" ELSE 0 END,
          "updatedAt" = NOW()
  `;
}

export type PacingGate =
  | { ok: true; viewsToday: number; limit: number }
  | { ok: false; reason: "PAUSED"; resumeAt: Date }
  | { ok: false; reason: "DAILY_LIMIT"; viewsToday: number; limit: number };

/** Read-only gate check for scheduled runs (doesn't consume a view). */
export async function getPacingGate(key = GLOBAL_KEY): Promise<PacingGate> {
  await ensureCurrentDay(key);
  const row = await prisma.scrapeThrottle.findUniqueOrThrow({ where: { id: key } });
  const limit = dailyProfileViewLimit();

  if (row.pausedUntil && row.pausedUntil > new Date()) {
    return { ok: false, reason: "PAUSED", resumeAt: row.pausedUntil };
  }
  if (row.profileViews >= limit) {
    return { ok: false, reason: "DAILY_LIMIT", viewsToday: row.profileViews, limit };
  }
  return { ok: true, viewsToday: row.profileViews, limit };
}

/**
 * Consumes one profile view. With `enforce`, it only succeeds while under the
 * daily cap — the conditional UPDATE makes that atomic across concurrent
 * runners. Without `enforce` (a user explicitly clicking "Run check now") the
 * view is still counted but never refused.
 */
export async function reserveProfileView(opts: { enforce: boolean; limit?: number; key?: string }): Promise<boolean> {
  const key = opts.key ?? GLOBAL_KEY;
  const limit = opts.limit ?? dailyProfileViewLimit();
  await ensureCurrentDay(key);

  const updated = opts.enforce
    ? await prisma.$executeRaw`
        UPDATE scrape_throttle SET "profileViews" = "profileViews" + 1, "updatedAt" = NOW()
        WHERE id = ${key} AND "profileViews" < ${limit}`
    : await prisma.$executeRaw`
        UPDATE scrape_throttle SET "profileViews" = "profileViews" + 1, "updatedAt" = NOW()
        WHERE id = ${key}`;
  return updated === 1;
}

/** Outcomes that mean "Instagram pushed back", as opposed to data problems. */
const SOFT_BLOCK_OUTCOMES = new Set(["RATE_LIMITED", "SESSION_FLAGGED"]);

/**
 * Feeds a finished check into the circuit breaker. Returns the pause end time
 * if this outcome tripped a pause, else null.
 */
export async function recordCheckOutcome(outcome: string, key = GLOBAL_KEY): Promise<Date | null> {
  await ensureCurrentDay(key);

  if (outcome === "OK") {
    await prisma.scrapeThrottle.update({
      where: { id: key },
      data: { consecutiveSoftFails: 0, pauseLevel: 0 },
    });
    return null;
  }
  if (!SOFT_BLOCK_OUTCOMES.has(outcome)) return null; // neutral (e.g. not found)

  const row = await prisma.scrapeThrottle.update({
    where: { id: key },
    data: { consecutiveSoftFails: { increment: 1 } },
  });
  if (row.consecutiveSoftFails < SOFT_FAIL_THRESHOLD) return null;

  const pauseMs = Math.min(BASE_PAUSE_MS * 2 ** row.pauseLevel, MAX_PAUSE_MS);
  const pausedUntil = new Date(Date.now() + pauseMs);
  await prisma.scrapeThrottle.update({
    where: { id: key },
    data: { pausedUntil, consecutiveSoftFails: 0, pauseLevel: { increment: 1 } },
  });
  console.warn(
    `[pacing] ${row.consecutiveSoftFails} soft blocks in a row — pausing scheduled checks for ${Math.round(pauseMs / 60000)} min`
  );
  return pausedUntil;
}
