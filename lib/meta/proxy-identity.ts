/**
 * Keeps each logged-in (burner) account on one fixed IP.
 *
 * A logged-in account whose requests jump between IPs, or that logs in from
 * the server's own connection (your home IP when running locally: the same
 * one your real account uses), is the easiest thing for Instagram to flag or
 * link. So burners always get a sticky proxy of their own.
 *
 * Webshare format (checked live 2026-09-27): username "<user>-rotate" picks a
 * new IP per connection; "<user>-<n>" pins proxy n of the list (same IP every time).
 */
import { prisma } from "@/lib/prisma";
import { decryptProxyUrl } from "./proxy-secret";

const ROTATE_SUFFIX = "-rotate";
const MAX_STICKY_INDEX = 100;

function parse(url: string | null | undefined): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isRotatingProxy(url: string | null | undefined): boolean {
  const u = parse(url);
  return Boolean(u && decodeURIComponent(u.username).endsWith(ROTATE_SUFFIX));
}

/** "<user>-rotate" → "<user>-<index>" on the same host and password. */
export function stickyVariant(rotatingUrl: string, index: number): string | null {
  const u = parse(rotatingUrl);
  if (!u || !isRotatingProxy(rotatingUrl)) return null;
  // Edit only the username, keeping the rest byte-for-byte (URL.toString would drop ":80").
  const rawUser = u.username;
  const at = rotatingUrl.indexOf(`//${rawUser}`);
  if (at < 0) return null;
  const start = at + 2;
  return `${rotatingUrl.slice(0, start)}${rawUser.slice(0, -ROTATE_SUFFIX.length)}-${index}${rotatingUrl.slice(start + rawUser.length)}`;
}

/** The sticky index a URL uses on the default proxy account, if any. */
function stickyIndexOf(url: string | null, rotatingUrl: string): number | null {
  const u = parse(url);
  const base = parse(rotatingUrl);
  if (!u || !base || u.host !== base.host) return null;
  const prefix = decodeURIComponent(base.username).slice(0, -ROTATE_SUFFIX.length);
  const m = decodeURIComponent(u.username).match(/-(\d+)$/);
  if (!m || decodeURIComponent(u.username) !== `${prefix}-${m[1]}`) return null;
  return Number(m[1]);
}

/**
 * The lowest proxy number not already pinned to another burner (across all
 * users, since they share one proxy account), so no two burners share an IP.
 * Null when the default proxy isn't a Webshare rotating one.
 */
export async function assignStickyProxy(excludeSessionId?: string): Promise<string | null> {
  const base = process.env.DEFAULT_PROXY_URL?.trim();
  if (!base || !isRotatingProxy(base)) return null;
  const sessions = await prisma.instagramSession.findMany({
    where: excludeSessionId ? { id: { not: excludeSessionId } } : {},
    select: { proxyUrl: true, proxyUrlIv: true },
  });
  const used = new Set(sessions.map((s) => stickyIndexOf(decryptProxyUrl(s), base)).filter((n): n is number => n !== null));
  for (let i = 1; i <= MAX_STICKY_INDEX; i++) {
    if (!used.has(i)) return stickyVariant(base, i);
  }
  return null;
}

export class UnsafeSessionProxyError extends Error {}

/**
 * The proxy a burner must use. A provided proxy must be fixed (not rotating);
 * with none provided, one is assigned from the default proxy account. Throws
 * rather than ever letting a login go out over the server's own connection.
 */
export async function resolveSessionProxy(provided: string | null | undefined): Promise<string> {
  const given = provided?.trim();
  if (given) {
    if (isRotatingProxy(given)) {
      throw new UnsafeSessionProxyError(
        'A logged-in account must keep one IP. Use a fixed proxy (for Webshare, replace "-rotate" in the username with a number like "-1"), or leave it empty to get one automatically.',
      );
    }
    return given;
  }
  const sticky = await assignStickyProxy();
  if (sticky) return sticky;
  const fallback = process.env.DEFAULT_PROXY_URL?.trim();
  if (fallback) return fallback; // a single static proxy is already fixed
  throw new UnsafeSessionProxyError(
    "Add a proxy for this account. Without one it would log in from this server's own internet connection, which can link it to your real account.",
  );
}
