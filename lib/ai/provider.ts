import type { MediaInput } from "./gemini";

export interface AIProvider {
  id: string;
  name: string;
  isConfigured(userId?: string): boolean | Promise<boolean>;
  generateJson<T>(params: {
    userId?: string;
    prompt: string;
    schema: Record<string, unknown>;
    media?: MediaInput[];
    model?: string;
  }): Promise<T>;
  speak?(params: {
    userId?: string;
    text: string;
    style?: string;
    voice?: string;
    model?: string;
  }): Promise<{ wav: Buffer; mimeType: string }>;
}
