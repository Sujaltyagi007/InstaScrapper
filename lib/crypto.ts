import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended for GCM

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to your environment."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded). Generate one with `openssl rand -base64 32`."
    );
  }
  return key;
}

export interface EncryptedPayload {
  ciphertext: string; // base64, includes appended auth tag
  iv: string; // base64
}

/**
 * Encrypts a plaintext string (access tokens, webhook secrets, etc.) for
 * storage at rest. Never log the plaintext or the returned ciphertext.
 */
export function encryptSecret(plaintext: string): EncryptedPayload {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, authTag]).toString("base64"),
    iv: iv.toString("base64"),
  };
}

export function decryptSecret(payload: EncryptedPayload): string {
  const key = getKey();
  const iv = Buffer.from(payload.iv, "base64");
  const data = Buffer.from(payload.ciphertext, "base64");
  const authTag = data.subarray(data.length - 16);
  const encrypted = data.subarray(0, data.length - 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

/** Convenience helper for JSON-shaped secrets (e.g. notification channel config). */
export function encryptJson(value: unknown): EncryptedPayload {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(payload: EncryptedPayload): T {
  return JSON.parse(decryptSecret(payload)) as T;
}
