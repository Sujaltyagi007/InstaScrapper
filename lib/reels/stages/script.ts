import { prisma } from "@/lib/prisma";
import { GEMINI_DEFAULT_VOICE, generateJson } from "@/lib/ai/gemini";
import { NARRATOR_VOICES, type ReelScript } from "@/lib/reels/types";
import type { StageContext, StageResult } from "./context";

const MIN_WORDS = 35;
const MAX_WORDS = 140;

function clean(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ") // pause tags or markup would be read aloud or break the timing
    .replace(/[\p{Extended_Pictographic}#]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function recentVoices(userId: string, excludeId: string): Promise<string[]> {
  const recent = await prisma.reelProject.findMany({
    where: { userId, id: { not: excludeId } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { script: true },
  });
  return recent.map((p) => (p.script as ReelScript | null)?.voice).filter((v): v is string => Boolean(v));
}

export async function runScriptStage({ project, idea }: StageContext): Promise<StageResult> {
  const sources = await prisma.media.findMany({
    where: { id: { in: idea.sourceMediaIds } },
    select: { caption: true },
  });
  const avoidVoices = await recentVoices(project.userId, project.id);
  const niche = idea.niche;

  const result = await generateJson<{ sentences: { text: string; visual: string }[]; voice: string; voiceStyle: string }>({
    prompt: [
      `You write voiceover scripts for original Instagram reels in the niche "${niche.name}"${niche.description ? ` (${niche.description})` : ""}. Write in language code "${niche.language}".`,
      ``,
      `Idea: ${idea.title}`,
      `Angle: ${idea.angle}`,
      `Suggested hook: ${idea.hook}`,
      `Why the topic is trending: ${idea.whyTrending}`,
      sources.length ? `\nCaptions of the trending reels it's based on, for context only. Never reuse their wording, jokes or structure:` : "",
      ...sources.map((s) => `- ${(s.caption ?? "").replace(/\s+/g, " ").slice(0, 300)}`),
      ``,
      `Write a 20-40 second voiceover, ${MIN_WORDS + 25}-${MAX_WORDS - 40} words in total, as 5-9 sentences.`,
      `Rules:`,
      `- Sentence 1 is the hook: use or sharpen the suggested hook, under 12 words.`,
      `- Each sentence under 18 words, one idea per sentence, natural spoken language.`,
      `- No emojis, hashtags, stage directions or pause markers.`,
      `- Be factually careful. Don't invent statistics, dates or quotes; if unsure, say it more generally.`,
      `- End on a satisfying payoff line. A short follow prompt is fine only if it sounds natural.`,
      `- "visual" for each sentence: a broad 2-3 word stock-footage search query for a scene that fits the mood, using common words stock libraries actually have (e.g. "moon surface", "astronaut helmet", "night sky stars", "city traffic night"). Prefer scenes over specific objects: "gold olive branch" finds nothing useful, "moon surface" does. No celebrities, brands, logos or specific real events.`,
      `- "voice": the narrator voice that best fits the niche and tone, from: ${Object.entries(NARRATOR_VOICES)
        .map(([name, desc]) => `${name} (${desc})`)
        .join(", ")}.${avoidVoices.length ? ` Recently used: ${avoidVoices.join(", ")}; prefer a different one.` : ""}`,
      `- "voiceStyle": a short delivery direction for the narrator, e.g. "curious and warm, medium pace, a hint of wonder".`,
    ]
      .filter((line) => line !== "")
      .join("\n"),
    schema: {
      type: "object",
      properties: {
        sentences: {
          type: "array",
          items: {
            type: "object",
            properties: { text: { type: "string" }, visual: { type: "string" } },
            required: ["text", "visual"],
          },
        },
        voice: { type: "string" },
        voiceStyle: { type: "string" },
      },
      required: ["sentences", "voice", "voiceStyle"],
    },
  });

  const sentences = (result.sentences ?? [])
    .map((s) => ({ text: clean(s.text ?? ""), visual: clean(s.visual ?? "") }))
    .filter((s) => s.text.length > 0);
  const words = sentences.reduce((n, s) => n + s.text.split(" ").length, 0);
  if (sentences.length < 3 || sentences.length > 12 || words < MIN_WORDS || words > MAX_WORDS) {
    throw new Error(`Script came back the wrong length (${sentences.length} sentences, ${words} words).`);
  }

  const script: ReelScript = {
    sentences,
    voice: result.voice in NARRATOR_VOICES ? result.voice : GEMINI_DEFAULT_VOICE,
    voiceStyle: clean(result.voiceStyle ?? "") || "clear, engaging narrator",
  };
  return { script: script as object };
}
