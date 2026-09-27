import crypto from "crypto";

function secret(): string | null {
  return process.env.NEXTAUTH_SECRET || process.env.ENCRYPTION_KEY || null;
}

function sign(body: string, key: string): string {
  return crypto.createHmac("sha256", key).update(body).digest("base64url");
}

export function signToken(payload: object, ttlMs: number): string | null {
  const key = secret();
  if (!key) return null;
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

export function verifyToken<T>(token: string | null | undefined): T | null {
  const key = secret();
  if (!key || !token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(body, key));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
