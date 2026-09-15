import { promises as dns } from "dns";
import net from "net";

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

export class UnsafeUrlError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const int = ipv4ToInt(ip);
  // Loopback, RFC1918, link-local/cloud-metadata, CGNAT, multicast/reserved, etc.
  const ranges: [string, number][] = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  return ranges.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (int & mask) === (ipv4ToInt(base) & mask);
  });
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/**
 * Blocks outbound requests to loopback/private/link-local/metadata addresses
 * before this server fetches a user-supplied URL (notification webhooks).
 * Resolves DNS once up front; doesn't pin the connection to the resolved IP,
 * so a slow DNS-rebind between this check and the fetch is a residual risk.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("Invalid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http:// and https:// URLs are allowed.");
  }

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UnsafeUrlError("This host is not allowed.");
  }

  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    const blocked = literalFamily === 4 ? isPrivateIPv4(hostname) : isPrivateIPv6(hostname);
    if (blocked) throw new UnsafeUrlError("This address is not allowed.");
    return;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError("Could not resolve host.");
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError("Could not resolve host.");
  }

  for (const { address, family } of addresses) {
    const blocked = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
    if (blocked) throw new UnsafeUrlError("This address is not allowed.");
  }
}
