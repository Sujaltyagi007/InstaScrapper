
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

function modelChain(list: string | undefined, single: string | undefined, defaults: string[]): string[] {
  const fromList = (list ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const chain = fromList.length ? fromList : defaults;
  const first = single?.trim();
  return first ? [first, ...chain.filter((m) => m !== first)] : chain;
}

export const GEMINI_TEXT_MODELS = modelChain(process.env.GEMINI_TEXT_MODELS, process.env.GEMINI_TEXT_MODEL, [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
]);
export const GEMINI_TTS_MODELS = modelChain(process.env.GEMINI_TTS_MODELS, process.env.GEMINI_TTS_MODEL, [
  "gemini-3.8-flash-tts",
  "gemini-3.8-flash-lite-tts",
]);
export const GEMINI_TEXT_MODEL = GEMINI_TEXT_MODELS[0];
export const GEMINI_TTS_MODEL = GEMINI_TTS_MODELS[0];
export const GEMINI_DEFAULT_VOICE = process.env.GEMINI_TTS_VOICE?.trim() || "Kore";

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly quotaExceeded: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export interface MediaInput {
  kind: "image" | "audio" | "video";
  data: Buffer;
  mimeType: string;
}

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim() ?? "";
  return key.length > 0 && !key.startsWith("your_");
}

const RETRY_DELAYS_MS = [2_000, 5_000];
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RATE_LIMIT_WAIT_MS = 40_000;

function errorMessage(text: string): string {
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text.slice(0, 500);
  } catch {
    return text.slice(0, 500);
  }
}

function perMinuteRetryMs(message: string): number | null {
  if (!/per minute/i.test(message)) return null;
  const hint = message.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  return hint ? Math.ceil(Number(hint[1]) * 1000) : 60_000;
}

async function interact(body: Record<string, unknown>): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new GeminiError("GEMINI_API_KEY is not set.", 0, false);

  let res: Response;
  let text: string;
  let waitedForRateLimit = false;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      text = await res.text();
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new GeminiError(`Gemini didn't answer within ${REQUEST_TIMEOUT_MS / 1000}s.`, 504, false);
      }
      throw err;
    }
    if (res.status === 429 && !waitedForRateLimit) {
      const wait = perMinuteRetryMs(errorMessage(text));
      if (wait !== null && wait <= MAX_RATE_LIMIT_WAIT_MS) {
        waitedForRateLimit = true;
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
    }
    if (res.status < 500 || attempt >= RETRY_DELAYS_MS.length) break;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
  if (!res.ok) {
    const message = errorMessage(text);
    const retryMs = res.status === 429 ? perMinuteRetryMs(message) : null;
    throw new GeminiError(
      `Gemini ${res.status}: ${message}`,
      res.status,
      res.status === 429 && retryMs === null,
      retryMs ?? undefined,
    );
  }
  return JSON.parse(text);
}

interface ContentBlock {
  type?: string;
  text?: string;
  data?: string;
  mime_type?: string;
}

function outputBlocks(res: unknown): ContentBlock[] {
  const steps = (res as { steps?: { type?: string; content?: ContentBlock[] }[] }).steps ?? [];
  return steps.filter((s) => s.type === "model_output").flatMap((s) => s.content ?? []);
}

function outputText(res: unknown): string {
  const r = res as { output_text?: string; outputText?: string };
  const direct = r.output_text ?? r.outputText;
  if (typeof direct === "string") return direct;
  const text = outputBlocks(res)
    .filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
  if (!text) throw new GeminiError(`Gemini returned no text: ${JSON.stringify(res).slice(0, 300)}`, 200, false);
  return text;
}

function buildInput(prompt: string, media: MediaInput[]): unknown {
  if (media.length === 0) return prompt;
  return [
    { type: "text", text: prompt },
    ...media.map((m) => ({ type: m.kind, data: m.data.toString("base64"), mime_type: m.mimeType })),
  ];
}

const exhaustedUntil = new Map<string, number>();
const EXHAUSTED_SKIP_MS = 60 * 60_000;

async function withModelFallback<T>(models: string[], call: (model: string) => Promise<T>): Promise<T> {
  const now = Date.now();
  const available = models.filter((m) => (exhaustedUntil.get(m) ?? 0) <= now);
  let lastError: unknown = null;
  let timedOutFallbackUsed = false;
  for (const model of available.length ? available : models) {
    try {
      return await call(model);
    } catch (err) {
      const limited = err instanceof GeminiError && (err.quotaExceeded || err.retryAfterMs !== undefined);
      // 504 = our own request timeout: a slow model shouldn't stop the chain.
      const transientServerError = err instanceof GeminiError && err.status >= 500 && err.status <= 504;
      const timedOut = err instanceof GeminiError && err.status === 504;
      if (!limited && !transientServerError && !timedOut && !(err instanceof GeminiError && err.status === 404)) throw err;
      if (timedOut && timedOutFallbackUsed) throw err;
      if (timedOut) timedOutFallbackUsed = true;
      if (err instanceof GeminiError && err.quotaExceeded) exhaustedUntil.set(model, now + EXHAUSTED_SKIP_MS);
      console.warn(`[gemini] ${model} unavailable, trying the next model:`, (err as Error).message.slice(0, 160));
      lastError = err;
    }
  }
  throw lastError;
}

export async function generateJson<T>(params: {
  prompt: string;
  schema: Record<string, unknown>;
  media?: MediaInput[];
  model?: string;
}): Promise<T> {
  const input = buildInput(params.prompt, params.media ?? []);
  const res = await withModelFallback(params.model ? [params.model] : GEMINI_TEXT_MODELS, (model) =>
    interact({
      model,
      input,
      response_format: { type: "text", mime_type: "application/json", schema: params.schema },
    }),
  );
  const text = outputText(res);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiError(`Gemini returned invalid JSON: ${text.slice(0, 300)}`, 200, false);
  }
}


export async function speak(params: {
  text: string;
  style?: string;
  voice?: string;
  model?: string;
}): Promise<{ wav: Buffer; mimeType: string }> {
  const content: Record<string, unknown> = { type: "text", text: params.text };
  if (params.style) content.annotations = [{ type: "speech_metadata", style: params.style }];

  const res = await withModelFallback(params.model ? [params.model] : GEMINI_TTS_MODELS, (model) =>
    interact({
      model,
      input: [{ type: "user_input", content: [content] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: params.voice ?? GEMINI_DEFAULT_VOICE }] },
    }),
  );

  return audioFromResponse(res);
}

export interface DialogueTurn {
  speaker: string;
  /** May contain inline performance tags such as <short pause> or <sigh>. */
  text: string;
  style?: string;
}

/**
 * Two speakers performed in one call ("conversational" mode), so the voices
 * react to each other with natural timing instead of being stitched together.
 */
export async function speakDialogue(params: {
  turns: DialogueTurn[];
  speakers: { speaker: string; voice: string }[];
  model?: string;
}): Promise<{ wav: Buffer; mimeType: string }> {
  const content = params.turns.map((t) => ({
    type: "text",
    text: t.text,
    annotations: [{ type: "speech_metadata", speaker: t.speaker, ...(t.style ? { style: t.style } : {}) }],
  }));
  const res = await withModelFallback(params.model ? [params.model] : GEMINI_TTS_MODELS, (model) =>
    interact({
      model,
      input: [{ type: "user_input", content }],
      response_format: { type: "audio" },
      generation_config: { speech_config: { mode: "conversational", speakers: params.speakers } },
    }),
  );
  return audioFromResponse(res);
}

function audioFromResponse(res: unknown): { wav: Buffer; mimeType: string } {
  const audio = outputBlocks(res).filter((b) => b.type === "audio" && b.data).pop();
  if (!audio?.data) throw new GeminiError(`Gemini returned no audio: ${JSON.stringify(res).slice(0, 300)}`, 200, false);
  const bytes = Buffer.from(audio.data, "base64");
  const mimeType = audio.mime_type ?? "audio/wav";
  return { wav: mimeType.includes("wav") ? bytes : pcm16ToWav(bytes, 24000), mimeType };
}

function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
