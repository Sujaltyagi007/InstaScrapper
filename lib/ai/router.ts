import { OpenAIProvider } from "./openai";
import type { AIProvider } from "./provider";
import { GeminiProvider, speakDialogue as geminiSpeakDialogue } from "./gemini";

const PROVIDERS = [GeminiProvider, OpenAIProvider];

async function getAvailableProvider(capability: "generateJson" | "speak" = "generateJson", userId?: string): Promise<AIProvider> {
  for (const provider of PROVIDERS) {
    if (await provider.isConfigured(userId)) {
      if (capability === "speak" && !provider.speak) continue;
      return provider;
    }
  }
  throw new Error("No AI provider is configured.");
}

export const ai = {
  async generateJson<T>(params: Parameters<AIProvider["generateJson"]>[0]): Promise<T> {
    const provider = await getAvailableProvider("generateJson", params.userId);
    return provider.generateJson<T>(params);
  },

  async speak(params: Parameters<NonNullable<AIProvider["speak"]>>[0]): Promise<{ wav: Buffer; mimeType: string }> {
    const provider = await getAvailableProvider("speak", params.userId);
    return provider.speak!(params);
  },

  async speakDialogue(params: Parameters<typeof geminiSpeakDialogue>[0]) {
    if (!(await GeminiProvider.isConfigured(params.userId))) {
      throw new Error("Dialogue speaking requires Gemini to be configured.");
    }
    return geminiSpeakDialogue(params);
  },
  
  async isConfigured(userId?: string) {
    for (const p of PROVIDERS) {
      if (await p.isConfigured(userId)) return true;
    }
    return false;
  }
};
