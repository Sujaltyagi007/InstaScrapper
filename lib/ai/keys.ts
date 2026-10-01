/**
 * The only module that reads or writes API keys (`AIKey` rows + env fallbacks).
 *
 * - Keys are encrypted at rest (lib/crypto.ts); the browser only sees `last4`.
 *   Rows saved before encryption (no `keyIv`) are encrypted the first time they're read.
 * - Rotation: callers ask `getKeyEntries()` for usable keys in order (the user's
 *   own keys oldest first, then the server's env keys), try them one by one, and
 *   report each outcome with `reportKeyOutcome()`. Out-of-quota state is stored in
 *   the DB, so every server instance skips that key until its quota resets:
 *   key-wide (`exhaustedUntil`) or per model (`exhaustedScopes`, for Gemini, whose
 *   daily quotas are per model). A key the provider rejects becomes INVALID until
 *   the user re-checks it.
 * - When nothing usable is left, the user gets one alert (`alertKeysExhausted`).
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-helpers";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { PROVIDER_INFO, normalizeKey, type KeyProvider } from "./key-detect";
import { verifyKey, type KeyCheck } from "./key-verify";

export type { KeyProvider } from "./key-detect";

export interface KeyEntry {
  /** null = a server env key. */
  id: string | null;
  provider: KeyProvider;
  userId: string | null;
  key: string;
}

export type KeyOutcome =
  | { kind: "ok" }
  /** `scope` = the model whose quota ran out; without it the whole key rests. */
  | { kind: "exhausted"; until?: Date; scope?: string; message?: string }
  | { kind: "invalid"; message: string };

export interface UserKeySummary {
  id: string;
  provider: string;
  last4: string;
  status: "ACTIVE" | "INVALID";
  /** The whole key is out of quota until then. */
  exhaustedUntil: string | null;
  /** Models out of quota on this key (the key still works for others). */
  limitedScopes: { scope: string; until: string }[];
  lastError: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

const ENV_VARS: Record<KeyProvider, string[]> = {
  gemini: ["GEMINI_API_KEYS", "GEMINI_API_KEY"],
  openai: ["OPENAI_API_KEYS", "OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  groq: ["GROQ_API_KEY"],
  xai: ["XAI_API_KEY"],
  pexels: ["PEXELS_API_KEY"],
  pixabay: ["PIXABAY_API_KEY"],
  freesound: ["FREESOUND_API_KEY"],
  europeana: ["EUROPEANA_API_KEY"],
};

const DEFAULT_EXHAUSTED_MS = 60 * 60_000;
const INVALID_ENV_SKIP_MS = 24 * 60 * 60_000;
const ALERT_EVERY_MS = 6 * 60 * 60_000;

/** Env keys can't be marked in the DB, so their state lives per server instance. Keyed `fingerprint|scope`. */
const envSkipUntil = new Map<string, number>();
const lastAlertAt = new Map<string, number>();

export function fingerprintOf(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function envKeys(provider: KeyProvider): string[] {
  const name = ENV_VARS[provider].find((v) => process.env[v]?.trim());
  if (!name) return [];
  return (process.env[name] ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0 && !/your_/i.test(k));
}

/** Providers with a server-side fallback key, for the settings card. */
export function envKeyProviders(): KeyProvider[] {
  return (Object.keys(ENV_VARS) as KeyProvider[]).filter((p) => envKeys(p).length > 0);
}

function encryptedColumns(key: string) {
  const enc = encryptSecret(key);
  return { key: enc.ciphertext, keyIv: enc.iv, fingerprint: fingerprintOf(key), last4: key.slice(-4) };
}

/** Encrypts rows saved before keys were encrypted. Safe to call repeatedly. */
export async function migrateLegacyKeys(userId?: string): Promise<number> {
  const rows = await prisma.aIKey.findMany({ where: { keyIv: null, ...(userId ? { userId } : {}) } });
  for (const row of rows) {
    await prisma.aIKey.updateMany({ where: { id: row.id, keyIv: null }, data: encryptedColumns(row.key) });
  }
  return rows.length;
}

function plainKey(row: { key: string; keyIv: string | null }): string {
  return row.keyIv ? decryptSecret({ ciphertext: row.key, iv: row.keyIv }) : row.key;
}

/** `exhaustedScopes` as scope → reset time (ms), dropping ones already reset. */
function liveScopes(raw: unknown, now: number): Map<string, number> {
  const out = new Map<string, number>();
  if (!raw || typeof raw !== "object") return out;
  for (const [scope, value] of Object.entries(raw as Record<string, unknown>)) {
    const until = typeof value === "string" ? Date.parse(value) : NaN;
    if (until > now) out.set(scope, until);
  }
  return out;
}

/**
 * Usable keys for a provider (and model, as `scope`), in the order to try them.
 * With `lastResort`, when every key is resting, the one whose quota resets
 * soonest is returned anyway (quotas sometimes reset early), so a call doesn't
 * fail without trying.
 */
export async function getKeyEntries(
  provider: KeyProvider,
  userId?: string,
  opts: { lastResort?: boolean; scope?: string } = {},
): Promise<KeyEntry[]> {
  const now = Date.now();
  const rows = userId
    ? await prisma.aIKey.findMany({ where: { userId, provider, status: "ACTIVE" }, orderBy: { createdAt: "asc" } })
    : [];
  if (rows.some((r) => !r.keyIv)) void migrateLegacyKeys(userId).catch(() => undefined);

  const resting: { entry: KeyEntry; until: number }[] = [];
  const usable: KeyEntry[] = [];
  const seen = new Set<string>();
  const place = (entry: KeyEntry, until: number) => {
    if (until > now) resting.push({ entry, until });
    else usable.push(entry);
  };
  for (const row of rows) {
    const key = plainKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    const scoped = opts.scope ? (liveScopes(row.exhaustedScopes, now).get(opts.scope) ?? 0) : 0;
    place({ id: row.id, provider, userId: row.userId, key }, Math.max(row.exhaustedUntil?.getTime() ?? 0, scoped));
  }
  for (const key of envKeys(provider)) {
    if (seen.has(key)) continue;
    seen.add(key);
    const fp = fingerprintOf(key);
    const until = Math.max(envSkipUntil.get(`${fp}|*`) ?? 0, opts.scope ? (envSkipUntil.get(`${fp}|${opts.scope}`) ?? 0) : 0);
    place({ id: null, provider, userId: null, key }, until);
  }
  if (usable.length || !opts.lastResort) return usable;
  return resting.sort((a, b) => a.until - b.until).slice(0, 1).map((r) => r.entry);
}

/** Back-compat: the keys to try, as plain strings. */
export async function getProviderKeys(provider: KeyProvider, userId?: string): Promise<string[]> {
  return (await getKeyEntries(provider, userId, { lastResort: true })).map((e) => e.key);
}

/** Whether any non-rejected key exists for the provider (resting ones count). */
export async function hasProviderKey(provider: KeyProvider, userId?: string): Promise<boolean> {
  if (envKeys(provider).length > 0) return true;
  if (!userId) return false;
  return (await prisma.aIKey.count({ where: { userId, provider, status: "ACTIVE" } })) > 0;
}

/** The first usable key for a single-key service (footage and sound libraries). */
export async function getServiceKey(provider: KeyProvider, userId?: string): Promise<KeyEntry | null> {
  return (await getKeyEntries(provider, userId, { lastResort: true }))[0] ?? null;
}

/** Gemini's daily quotas reset at midnight Pacific time. */
export function nextPacificMidnight(now = new Date()): Date {
  const la = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const wall = (d: Date) =>
    Object.fromEntries(
      la.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]),
    ) as Record<string, number>;
  // Los Angeles' UTC offset at a given instant (it changes with daylight saving).
  const offsetAt = (d: Date) => {
    const w = wall(d);
    return Math.round((Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - d.getTime()) / 60_000) * 60_000;
  };
  const today = wall(now);
  const midnightWall = Date.UTC(today.year, today.month - 1, today.day + 1);
  // First guess with today's offset, then correct with the offset at that moment,
  // so the night the clocks change still lands on midnight.
  const guess = midnightWall - offsetAt(now);
  return new Date(midnightWall - offsetAt(new Date(guess)));
}

/**
 * Tells the user that no key for a provider works right now. Called by a client
 * once a whole request has failed for lack of quota or valid keys. At most one
 * alert per user and provider every 6 hours (per server instance).
 */
export async function alertKeysExhausted(userId: string | undefined, provider: KeyProvider): Promise<void> {
  if (!userId) return;
  const throttleKey = `${userId}|${provider}`;
  const now = Date.now();
  if (now - (lastAlertAt.get(throttleKey) ?? 0) < ALERT_EVERY_MS) return;
  lastAlertAt.set(throttleKey, now);
  try {
    const label = PROVIDER_INFO[provider].label;
    const { sendAccountAlert } = await import("@/lib/services/notification.service");
    await sendAccountAlert(userId, {
      title: `${label} keys are used up`,
      body: `Every ${label} key is out of quota or not working, so work that needs ${label} will wait. Add another key in Settings → Connections, or it resumes when the quota resets.`,
      kind: "AI_KEYS_EXHAUSTED",
    });
  } catch (err) {
    console.warn("[keys] couldn't send the keys-exhausted alert:", (err as Error).message);
  }
}

/** Providers often wrap the reason in JSON; keep just the human-readable message. */
function readableError(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const quoted = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const text = quoted ? quoted[1].replace(/\\"/g, '"') : raw;
  return text.replace(/\s+/g, " ").trim().slice(0, 300) || fallback;
}

/**
 * Records how a key did. Never throws: bookkeeping must not fail the request
 * that used the key.
 */
export async function reportKeyOutcome(entry: KeyEntry, outcome: KeyOutcome): Promise<void> {
  try {
    const now = new Date();
    const tag = `${entry.provider} key …${entry.key.slice(-4)}`;
    if (!entry.id) {
      if (outcome.kind === "ok") return;
      const fp = fingerprintOf(entry.key);
      if (outcome.kind === "exhausted") {
        envSkipUntil.set(`${fp}|${outcome.scope ?? "*"}`, outcome.until?.getTime() ?? now.getTime() + DEFAULT_EXHAUSTED_MS);
      } else {
        envSkipUntil.set(`${fp}|*`, now.getTime() + INVALID_ENV_SKIP_MS);
        console.warn(`[keys] server ${tag} was rejected: ${outcome.message.slice(0, 160)}`);
      }
      return;
    }

    if (outcome.kind === "ok") {
      await prisma.aIKey.updateMany({ where: { id: entry.id }, data: { lastUsedAt: now } });
      return;
    }

    if (outcome.kind === "exhausted") {
      const until = outcome.until ?? new Date(now.getTime() + DEFAULT_EXHAUSTED_MS);
      const message = readableError(outcome.message, "Out of quota.");
      if (outcome.scope) {
        const row = await prisma.aIKey.findUnique({ where: { id: entry.id }, select: { exhaustedScopes: true } });
        const scopes = Object.fromEntries(
          [...liveScopes(row?.exhaustedScopes, now.getTime())].map(([s, t]) => [s, new Date(t).toISOString()]),
        );
        scopes[outcome.scope] = until.toISOString();
        await prisma.aIKey.updateMany({ where: { id: entry.id }, data: { exhaustedScopes: scopes, lastError: message } });
      } else {
        await prisma.aIKey.updateMany({ where: { id: entry.id }, data: { exhaustedUntil: until, lastError: message } });
      }
      console.warn(`[keys] ${tag} out of quota${outcome.scope ? ` for ${outcome.scope}` : ""} until ${until.toISOString()}; rotating.`);
      return;
    }

    await prisma.aIKey.updateMany({
      where: { id: entry.id, status: "ACTIVE" },
      data: { status: "INVALID", lastError: readableError(outcome.message, "The provider rejected this key.") },
    });
    console.warn(`[keys] ${tag} was rejected; rotating.`);
  } catch (err) {
    console.warn("[keys] couldn't record key outcome:", (err as Error).message);
  }
}

/* ---------- The user's own keys (settings card) ---------- */

type KeyRow = Awaited<ReturnType<typeof prisma.aIKey.findFirstOrThrow>>;

function summary(row: KeyRow): UserKeySummary {
  const now = Date.now();
  return {
    id: row.id,
    provider: row.provider,
    last4: row.last4,
    status: row.status === "INVALID" ? "INVALID" : "ACTIVE",
    exhaustedUntil: row.exhaustedUntil && row.exhaustedUntil.getTime() > now ? row.exhaustedUntil.toISOString() : null,
    limitedScopes: [...liveScopes(row.exhaustedScopes, now)].map(([scope, until]) => ({ scope, until: new Date(until).toISOString() })),
    lastError: row.lastError,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listUserKeys(userId: string): Promise<UserKeySummary[]> {
  await migrateLegacyKeys(userId);
  const rows = await prisma.aIKey.findMany({ where: { userId }, orderBy: [{ provider: "asc" }, { createdAt: "asc" }] });
  return rows.map(summary);
}

function checkFailure(provider: KeyProvider, check: KeyCheck): ApiError | null {
  const label = PROVIDER_INFO[provider].label;
  if (check.result === "invalid") {
    return new ApiError(422, `${label} rejected this key: ${check.message}`, "KEY_INVALID");
  }
  if (check.result === "unreachable") {
    return new ApiError(502, `Couldn't check the key with ${label} (${check.message}).`, "KEY_CHECK_FAILED", { canForce: true });
  }
  return null;
}

/**
 * Checks the key with the provider, then saves it encrypted. `force` saves a key
 * the provider couldn't be reached to check (never one it rejected). A key that
 * is real but rate-limited right now is saved; rotation finds out when it frees up.
 */
export async function addUserKey(
  userId: string,
  provider: KeyProvider,
  rawKey: string,
  opts: { force?: boolean } = {},
): Promise<{ key: UserKeySummary; check: KeyCheck["result"] }> {
  const key = normalizeKey(rawKey);
  if (key.length < 8 || key.length > 400) throw new ApiError(400, "That doesn't look like an API key.", "KEY_MALFORMED");

  await migrateLegacyKeys(userId);
  const existing = await prisma.aIKey.findFirst({ where: { userId, fingerprint: fingerprintOf(key) } });
  if (existing) {
    const label = PROVIDER_INFO[existing.provider as KeyProvider]?.label ?? existing.provider;
    throw new ApiError(409, `This key is already saved (${label} ••••${existing.last4}).`, "KEY_DUPLICATE");
  }

  const check = await verifyKey(provider, key);
  const failure = checkFailure(provider, check);
  if (failure && !(opts.force && check.result === "unreachable")) throw failure;

  const row = await prisma.aIKey.create({
    data: {
      userId,
      provider,
      ...encryptedColumns(key),
      status: "ACTIVE",
      lastError: check.result === "limited" || check.result === "unreachable" ? check.message : null,
    },
  });
  return { key: summary(row), check: check.result };
}

/** "Check again": re-tests a saved key, and clears its resting state if it works. */
export async function recheckUserKey(userId: string, id: string): Promise<{ key: UserKeySummary; check: KeyCheck["result"] }> {
  const row = await prisma.aIKey.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "Key not found.");
  const provider = row.provider as KeyProvider;
  const check = await verifyKey(provider, plainKey(row));
  if (check.result === "unreachable") throw checkFailure(provider, check)!;

  const updated = await prisma.aIKey.update({
    where: { id },
    data:
      check.result === "invalid"
        ? { status: "INVALID", lastError: check.message }
        : // A listing call can't tell whether a model's daily quota is back, so
          // "limited" keeps its scopes; "ok" clears key-wide rest only.
          { status: "ACTIVE", exhaustedUntil: null, lastError: check.result === "limited" ? check.message : null },
  });
  return { key: summary(updated), check: check.result };
}

export async function deleteUserKey(userId: string, id: string): Promise<void> {
  const { count } = await prisma.aIKey.deleteMany({ where: { id, userId } });
  if (count === 0) throw new ApiError(404, "Key not found.");
}
