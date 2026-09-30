export type ProviderMode = "MOCK" | "GRAPH" | "STEALTH";

/** Resolves the selected provider without importing provider implementations. */
export function getProviderMode(): ProviderMode {
  const mode = process.env.INSTAGRAM_PROVIDER_MODE?.toUpperCase();
  if (mode === "STEALTH") return "STEALTH";
  if (mode === "GRAPH") return "GRAPH";
  if (mode === "MOCK") return "MOCK";
  if (process.env.META_APP_ID && process.env.META_APP_SECRET) return "GRAPH";
  if (process.env.MOCK_META_API === "false") return "STEALTH";
  return "MOCK";
}