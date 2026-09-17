/**
 * Timezone-aware scheduling math for human-like check times. Pure functions,
 * no I/O, so they can be tested in isolation.
 *
 * Hours are local hours in a user's IANA timezone. Windows are half-open
 * [startHour, endHour) and may wrap midnight: {22, 6} means 22:00–05:59.
 * startHour === endHour is treated as an empty window (never inside).
 */

const STEP_MS = 5 * 60 * 1000;
const SEARCH_LIMIT_MS = 48 * 60 * 60 * 1000;

/** Returns a valid IANA zone, falling back to UTC for unknown/blank input. */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local hour (0–23) of `date` in `timeZone`. DST-safe via Intl. */
export function localHour(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone),
    hour: "numeric",
    hourCycle: "h23",
  }).format(date);
  return Number(hour) % 24;
}

export function isHourInWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour; // wraps midnight
}

export function isInWindow(date: Date, timeZone: string, startHour: number, endHour: number): boolean {
  return isHourInWindow(localHour(date, timeZone), startHour, endHour);
}

/**
 * First moment at or after `from` whose membership in the window equals
 * `wantInside`. Walks forward in 5-minute steps, which stays correct across
 * DST changes without date-library arithmetic. Returns `from` if no such
 * moment exists in 48h (e.g. an empty window when wanting "inside").
 */
function firstMomentWhere(
  from: Date,
  timeZone: string,
  startHour: number,
  endHour: number,
  wantInside: boolean
): Date {
  for (let t = from.getTime(); t <= from.getTime() + SEARCH_LIMIT_MS; t += STEP_MS) {
    if (isInWindow(new Date(t), timeZone, startHour, endHour) === wantInside) {
      return new Date(t);
    }
  }
  return from;
}

/** Earliest time ≥ `from` outside a sleep window (returns `from` if not asleep). */
export function nextAwakeTime(from: Date, timeZone: string, sleepStart: number, sleepEnd: number): Date {
  if (!isInWindow(from, timeZone, sleepStart, sleepEnd)) return from;
  return firstMomentWhere(from, timeZone, sleepStart, sleepEnd, false);
}

/** Earliest time ≥ `from` inside an allowed "active hours" window. */
export function nextActiveTime(from: Date, timeZone: string, activeStart: number, activeEnd: number): Date {
  if (activeStart === activeEnd) return from; // empty window = no restriction
  if (isInWindow(from, timeZone, activeStart, activeEnd)) return from;
  return firstMomentWhere(from, timeZone, activeStart, activeEnd, true);
}

/** Uniform random integer in [min, max]. `rand` injectable for tests. */
export function randomBetween(min: number, max: number, rand: () => number = Math.random): number {
  return Math.floor(min + rand() * (max - min + 1));
}

/**
 * Human-like gap before the next check, in seconds.
 *
 * People don't revisit a profile on a fixed timer. Most gaps land near the
 * configured interval (0.8×–1.25×), and roughly 1 in 7 is noticeably longer
 * (1.4×–2.2×), like getting distracted — never shorter than `minSeconds`.
 */
export function humanIntervalSeconds(
  baseSeconds: number,
  minSeconds: number,
  rand: () => number = Math.random
): number {
  const factor =
    rand() < 0.15
      ? 1.4 + rand() * 0.8 // occasional long gap
      : 0.8 + rand() * 0.45; // usual gap
  return Math.max(minSeconds, Math.round(baseSeconds * factor));
}
