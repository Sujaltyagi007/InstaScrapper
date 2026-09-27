/**
 * Picks when to send a finished reel to the user's phone: inside common
 * engagement windows in the user's timezone, never during their sleep hours,
 * at most a few per day and spaced apart, at a random minute so the posting
 * time isn't machine-regular. Pure; `rand` is injectable for tests.
 */
import { isHourInWindow, localHour } from "./time-windows";

export interface SendTimeOptions {
  timeZone: string;
  sleep: { enabled: boolean; startHour: number; endHour: number };
  /** Other reels already scheduled or sent (spacing + daily cap). */
  taken: Date[];
  maxPerDay?: number;
  rand?: () => number;
}

/** Local hours [start, end) when reels tend to get the most views. */
export const PRIME_WINDOWS: [number, number][] = [
  [11, 13],
  [19, 21],
];
const STEP_MS = 5 * 60_000;
const MIN_LEAD_MS = 10 * 60_000;
const MIN_GAP_MS = 3 * 60 * 60_000;
const SEARCH_DAYS = 7;

function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function pickSendTime(now: Date, opts: SendTimeOptions): Date {
  const maxPerDay = opts.maxPerDay ?? 2;
  const rand = opts.rand ?? Math.random;
  const perDay = new Map<string, number>();
  for (const t of opts.taken) {
    const key = dayKey(t, opts.timeZone);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const eligible = (t: number): boolean => {
    const date = new Date(t);
    const hour = localHour(date, opts.timeZone);
    if (!PRIME_WINDOWS.some(([a, b]) => isHourInWindow(hour, a, b))) return false;
    if (opts.sleep.enabled && isHourInWindow(hour, opts.sleep.startHour, opts.sleep.endHour)) return false;
    if ((perDay.get(dayKey(date, opts.timeZone)) ?? 0) >= maxPerDay) return false;
    return !opts.taken.some((x) => Math.abs(x.getTime() - t) < MIN_GAP_MS);
  };

  const start = Math.ceil((now.getTime() + MIN_LEAD_MS) / STEP_MS) * STEP_MS;
  for (let t = start; t < start + SEARCH_DAYS * 24 * 60 * 60_000; t += STEP_MS) {
    if (!eligible(t)) continue;
    // The first open window: pick a random slot within its contiguous eligible run.
    const run = [t];
    for (let u = t + STEP_MS; eligible(u) && run.length < 24; u += STEP_MS) run.push(u);
    const slot = run[Math.floor(rand() * run.length)];
    return new Date(slot + Math.floor(rand() * STEP_MS));
  }
  // Nothing free within a week (very full schedule): fall back to soon.
  return new Date(now.getTime() + MIN_LEAD_MS);
}
