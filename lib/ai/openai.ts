import type { AIProvider } from "./provider";
import { GeminiError, type MediaInput } from "./gemini";

const OPENAI_TEXT_MODELS = process.env.OPENAI_TEXT_MODELS?.split(",")
  .map((m) => m.trim())
  .filter(Boolean) || ["gpt-4o-mini", "gpt-4o"];
const OPENAI_TTS_MODELS = process.env.OPENAI_TTS_MODELS?.split(",")
  .map((m) => m.trim())
  .filter(Boolean) || ["tts-1"];
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE?.trim() || "alloy";

import { alertKeysExhausted, getKeyEntries, hasProviderKey, reportKeyOutcome } from "./keys";
import { looksLikeInvalidKey } from "./key-verify";

/** OpenAI's insufficient_quota is a billing state, not a daily reset: rest the key for a day. */
const QUOTA_REST_MS = 24 * 60 * 60_000;

function enforceStrictSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (schema.type === "object") {
    const properties = schema.properties || {};
    const strictProperties: Record<string, any> = {};
    for (const [key, value] of Object.entries(properties)) {
      strictProperties[key] = enforceStrictSchema(value);
    }
    return {
      ...schema,
      properties: strictProperties,
      additionalProperties: false,
    };
  }
  if (schema.type === "array" && schema.items) {
    return {
      ...schema,
      items: enforceStrictSchema(schema.items),
    };
  }
  return schema;
}

/**
 * Sends one OpenAI request, rotating through the user's keys and then the
 * server's. A key out of billing quota rests for a day and a rejected key is
 * marked invalid (both stored in the DB via lib/ai/keys.ts); the next key is
 * tried at once. A plain rate limit (429 without insufficient_quota) is not the
 * key's fault and is thrown as-is so the caller can wait.
 */
async function send(path: string, body: Record<string, unknown>, userId?: string): Promise<Response> {
  const entries = await getKeyEntries("openai", userId);
  if (entries.length === 0) {
    const resting = await hasProviderKey("openai", userId);
    throw new GeminiError(resting ? "Every OpenAI key is out of quota." : "No OpenAI API key is set.", resting ? 429 : 0, resting);
  }

  let lastError: GeminiError | null = null;
  for (const entry of entries) {
    const res = await fetch(`https://api.openai.com/v1${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${entry.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (res.ok) {
      void reportKeyOutcome(entry, { kind: "ok" });
      return res;
    }
    const text = await res.text().catch(() => "");
    let code: string | undefined;
    let message = text.slice(0, 200);
    try {
      const err = (JSON.parse(text) as { error?: { code?: string; message?: string } }).error;
      code = err?.code;
      message = err?.message ?? message;
    } catch {}

    if (res.status === 429 && code === "insufficient_quota") {
      await reportKeyOutcome(entry, { kind: "exhausted", until: new Date(Date.now() + QUOTA_REST_MS), message });
      lastError = new GeminiError(`OpenAI quota exceeded: ${message}`, 429, true);
      continue;
    }
    if (looksLikeInvalidKey(res.status, message) || code === "invalid_api_key") {
      await reportKeyOutcome(entry, { kind: "invalid", message });
      lastError = new GeminiError(`OpenAI rejected the key: ${message}`, res.status, false);
      continue;
    }
    if (res.status === 429) throw new GeminiError(`OpenAI rate limit: ${message}`, 429, false, 60_000);
    throw new GeminiError(`OpenAI ${res.status}: ${message}`, res.status, false);
  }
  void alertKeysExhausted(userId, "openai");
  throw lastError ?? new GeminiError("No usable OpenAI key.", 0, false);
}

async function interact(path: string, body: Record<string, unknown>, userId?: string): Promise<any> {
  return (await send(path, body, userId)).json();
}

export const OpenAIProvider: AIProvider = {
  id: "openai",
  name: "OpenAI",
  
  async isConfigured(userId?: string) {
    return hasProviderKey("openai", userId);
  },

  async generateJson<T>(params: {
    userId?: string;
    prompt: string;
    schema: Record<string, unknown>;
    media?: MediaInput[];
    model?: string;
  }): Promise<T> {
    const model = params.model ?? OPENAI_TEXT_MODELS[0];
    const strictSchema = enforceStrictSchema(params.schema);

    const content: any[] = [{ type: "text", text: params.prompt }];
    if (params.media) {
      for (const m of params.media) {
        if (m.kind === "image") {
          content.push({
            type: "image_url",
            image_url: { url: `data:${m.mimeType};base64,${m.data.toString("base64")}` },
          });
        }
        // OpenAI Vision doesn't support audio/video directly in the same way,
        // so we just ignore them or we'd need to extract frames for video.
      }
    }

    const res = await interact(
      "/chat/completions",
      {
        model,
        messages: [{ role: "user", content }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "result",
            schema: strictSchema,
            strict: true,
          },
        },
      },
      params.userId
    );

    const text = res.choices?.[0]?.message?.content;
    if (!text) throw new GeminiError(`OpenAI returned no text: ${JSON.stringify(res).slice(0, 300)}`, 200, false);
    
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GeminiError(`OpenAI returned invalid JSON: ${text.slice(0, 300)}`, 200, false);
    }
  },

  async speak(params: {
    userId?: string;
    text: string;
    style?: string;
    voice?: string;
    model?: string;
  }): Promise<{ wav: Buffer; mimeType: string }> {
    const model = params.model ?? OPENAI_TTS_MODELS[0];
    const voice = params.voice ?? OPENAI_TTS_VOICE;

    const res = await send(
      "/audio/speech",
      { model, input: params.text, voice, response_format: "wav" },
      params.userId,
    );

    const buffer = Buffer.from(await res.arrayBuffer());
    return { wav: buffer, mimeType: "audio/wav" };
  },
};
