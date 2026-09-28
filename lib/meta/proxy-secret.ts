import { decryptOptional, encryptOptional } from "@/lib/crypto";

/**
 * `InstagramSession.proxyUrl` holds ciphertext (it embeds the proxy account's
 * username/password), not a usable URL. This is the only place that should
 * cross that boundary — every read and write of the column goes through here.
 */

/** `{ proxyUrl, proxyUrlIv }` ready to spread into a Prisma `data` object. */
export function encryptProxyUrl(url: string | null | undefined): { proxyUrl: string | null; proxyUrlIv: string | null } {
  const enc = encryptOptional(url);
  return { proxyUrl: enc?.ciphertext ?? null, proxyUrlIv: enc?.iv ?? null };
}

/** The real proxy URL from a row's `proxyUrl`/`proxyUrlIv` columns, or null. */
export function decryptProxyUrl(record: { proxyUrl: string | null; proxyUrlIv: string | null }): string | null {
  return decryptOptional({ ciphertext: record.proxyUrl, iv: record.proxyUrlIv });
}
