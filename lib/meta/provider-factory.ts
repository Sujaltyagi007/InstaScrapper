import type { MetaProvider } from "./types";
import { MockMetaProvider } from "./mock-provider";
import { GraphMetaProvider } from "./graph-provider";
import { StealthMetaProvider } from "./stealth-provider";

let cached: MetaProvider | null = null;

export type ProviderMode = "MOCK" | "GRAPH" | "STEALTH";

export function getProviderMode(): ProviderMode {
  const mode = process.env.INSTAGRAM_PROVIDER_MODE?.toUpperCase();
  if (mode === "STEALTH") return "STEALTH";
  if (mode === "GRAPH") return "GRAPH";
  if (process.env.MOCK_META_API === "false") return "STEALTH";
  return "MOCK";
}

export function isMockMetaApi(): boolean {
  return getProviderMode() === "MOCK";
}

/**
 * Single place the rest of the app asks for "the current Meta/Instagram provider".
 * Supports MOCK, GRAPH (official Meta Graph API), and STEALTH (TLS fingerprint + session engine).
 */
export function getMetaProvider(): MetaProvider {
  if (cached) return cached;
  const mode = getProviderMode();
  if (mode === "STEALTH") {
    cached = new StealthMetaProvider();
  } else if (mode === "GRAPH") {
    cached = new GraphMetaProvider();
  } else {
    cached = new MockMetaProvider();
  }
  return cached;
}
