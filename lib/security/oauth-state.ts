import crypto from "crypto";

/** State is only accepted for 15 minutes, so a leaked callback URL goes stale. */
const STATE_MAX_AGE_MS = 15 * 60 * 1000;

function stateSecret(): string | null {
  return process.env.NEXTAUTH_SECRET || process.env.ENCRYPTION_KEY || null;
}

export function signOAuthState(userId: string): string | null {
  const secret = stateSecret();
  if (!secret) return null;
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `${userId}.${nonce}.${Date.now()}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

/** Returns the userId the state was issued for, or null if it's forged or expired. */
export function verifyOAuthState(state: string): string | null {
  const secret = stateSecret();
  if (!secret) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = decoded.split(".");
  if (parts.length !== 4) return null;
  const [userId, nonce, issuedAt, signature] = parts;
  const expected = crypto.createHmac("sha256", secret).update(`${userId}.${nonce}.${issuedAt}`).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!Number.isFinite(Number(issuedAt)) || Date.now() - Number(issuedAt) > STATE_MAX_AGE_MS) return null;
  return userId;
}
