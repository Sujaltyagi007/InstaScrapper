export const KEY_PROVIDERS = [
  "gemini",
  "openai",
  "anthropic",
  "openrouter",
  "groq",
  "xai",
  "pexels",
  "pixabay",
  "freesound",
  "europeana",
] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];

export interface ProviderInfo {
  label: string;
  usedFor: string;
  inUse: boolean;
  keyUrl: string;
}

export const PROVIDER_INFO: Record<KeyProvider, ProviderInfo> = {
  gemini: { label: "Google Gemini", usedFor: "scripts, voice, video checks", inUse: true, keyUrl: "https://aistudio.google.com/apikey" },
  openai: { label: "OpenAI", usedFor: "scripts and voice when Gemini is unavailable", inUse: true, keyUrl: "https://platform.openai.com/api-keys" },
  anthropic: { label: "Anthropic", usedFor: "saved for later; not used yet", inUse: false, keyUrl: "https://console.anthropic.com/settings/keys" },
  openrouter: { label: "OpenRouter", usedFor: "saved for later; not used yet", inUse: false, keyUrl: "https://openrouter.ai/settings/keys" },
  groq: { label: "Groq", usedFor: "saved for later; not used yet", inUse: false, keyUrl: "https://console.groq.com/keys" },
  xai: { label: "xAI (Grok)", usedFor: "saved for later; not used yet", inUse: false, keyUrl: "https://console.x.ai" },
  pexels: { label: "Pexels", usedFor: "stock footage and photos", inUse: true, keyUrl: "https://www.pexels.com/api/" },
  pixabay: { label: "Pixabay", usedFor: "stock footage", inUse: true, keyUrl: "https://pixabay.com/api/docs/" },
  freesound: { label: "Freesound", usedFor: "free sound effects", inUse: true, keyUrl: "https://freesound.org/apiv2/apply" },
  europeana: { label: "Europeana", usedFor: "historic archive footage", inUse: true, keyUrl: "https://pro.europeana.eu/pages/get-api" },
};

export interface KeyGuess {
  provider: KeyProvider | null;
  confidence: "sure" | "likely" | "unknown";
}

const RULES: { provider: KeyProvider; test: RegExp; confidence: "sure" | "likely" }[] = [
  { provider: "gemini", test: /^AIza[0-9A-Za-z_-]{35}$/, confidence: "sure" },
  { provider: "anthropic", test: /^sk-ant-[0-9A-Za-z_-]{20,}$/, confidence: "sure" },
  { provider: "openrouter", test: /^sk-or-[0-9A-Za-z_-]{20,}$/, confidence: "sure" },
  { provider: "openai", test: /^sk-[0-9A-Za-z_-]{20,}$/, confidence: "sure" },
  { provider: "groq", test: /^gsk_[0-9A-Za-z]{20,}$/, confidence: "sure" },
  { provider: "xai", test: /^xai-[0-9A-Za-z]{20,}$/, confidence: "sure" },
  { provider: "pixabay", test: /^\d{5,10}-[0-9a-f]{25}$/, confidence: "sure" },
  { provider: "pexels", test: /^[0-9A-Za-z]{56}$/, confidence: "likely" },
  { provider: "freesound", test: /^[0-9A-Za-z]{40}$/, confidence: "likely" },
];

export function normalizeKey(raw: string): string {
  let key = raw.trim();
  key = key.replace(/^export\s+/i, "");
  key = key.replace(/^[A-Z][A-Z0-9_]*\s*=\s*/, "");
  key = key.replace(/^bearer\s+/i, "");
  key = key.replace(/^["'`]|["'`]$/g, "");
  return key.replace(/\s+/g, "");
}

export function detectProvider(raw: string): KeyGuess {
  const key = normalizeKey(raw);
  for (const rule of RULES) {
    if (rule.test.test(key)) return { provider: rule.provider, confidence: rule.confidence };
  }
  return { provider: null, confidence: "unknown" };
}

export function isKeyProvider(value: unknown): value is KeyProvider {
  return typeof value === "string" && (KEY_PROVIDERS as readonly string[]).includes(value);
}

export function maskKey(last4: string): string {
  return `••••${last4}`;
}
