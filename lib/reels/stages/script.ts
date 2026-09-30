import { prisma } from "@/lib/prisma";
import { GEMINI_DEFAULT_VOICE, generateJson } from "@/lib/ai/gemini";
import { NARRATOR_VOICES, type ReelScript } from "@/lib/reels/types";
import { repairScriptDraft, validateScriptDraft, type ScriptDraftSentence } from "@/lib/reels/script-quality";
import type { StageContext, StageResult } from "./context";

const MIN_WORDS = 55;
const MAX_WORDS = 105;

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

  const basePrompt = [
      `You are a sharp short-form storyteller, not a teacher reading slides. Write an original voiceover reel in "${niche.name}"${niche.description ? ` (${niche.description})` : ""}, language "${niche.language}".`,
      ``,
      `Idea: ${idea.title}`,
      `Angle: ${idea.angle}`,
      `Suggested hook: ${idea.hook}`,
      `Why the topic is trending: ${idea.whyTrending}`,
      sources.length ? `\nCaptions of the trending reels it's based on, for context only. Never reuse their wording, jokes or structure:` : "",
      ...sources.map((s) => `- ${(s.caption ?? "").replace(/\s+/g, " ").slice(0, 300)}`),
      ``,
      `Write a 20-40 second voiceover: 6-9 beats and ${MIN_WORDS}-${MAX_WORDS} spoken words.`,
      `Build one small, coherent story: a relatable protagonist wants something, meets a specific obstacle, reacts in a revealing way, then gets a turn and payoff. Give the protagonist a recognizable attitude through choices and natural dialogue, not labels. This is one narrator: any quoted dialogue must be short and performable by that voice. For abstract topics, make the viewer the protagonist.`,
      `A second character is optional; if used, give them a contrasting want, attitude and reaction style that comes through in brief, distinct word choices. Never add a character just to deliver facts.`,
      `Use this ordered beat arc: hook, setup, build, escalation, turn, payoff. Include each once in order; extra beats must be builds. Every beat must change the situation, reveal character, add useful information, or create the next question. Cause and effect must be clear; the ending should resolve or call back to the opening.`,
      `Start inside the interesting moment. Make the first spoken line a concrete surprise, contradiction, vivid situation, pointed question, or conflict. No warm-up or generic intro. Do not use "today we're going to", "in this video", "welcome back", or "let's talk about".`,
      `Sound spoken, not written: contractions, varied sentence lengths, specific reactions, occasional natural hesitation or quoted line. Use humor only when it grows from the situation or personality. No lecture cadence, corporate phrasing, generic motivational language, filler, repeated facts, emojis, hashtags, stage directions, or pause markup.`,
      `Keep facts honest. Do not invent statistics, studies, dates, quotes, or claim a fictional scenario really happened. Clearly frame an illustrative scenario as illustrative. Use source captions only as topic context; do not copy them.`,
      `For every beat return:`,
      `- "text": spoken words only, one concise sentence, usually 7-17 words and never over 20. The hook is at most 12 words.`,
      `- "visual": 2-5 concrete stock-search words naming an observable subject/action/environment; avoid generic terms like "person walking", "office", "talking head", "motivation" or "b-roll".`,
      `- "shot": one specific, filmable moment that supports this exact line: subject, visible action/reaction, and useful composition or environmental detail. Make adjacent shots feel like progression, not unrelated footage. Each shot must work as one stock clip; no impossible continuity or multiple cuts.`,
      `- "beat": one of hook, setup, build, escalation, turn, payoff, matching the story role.`,
      `- "energy": one of quiet, curious, playful, tense, surprised, energized, relieved, warm. Vary the emotional temperature; use at least three across the script.`,
      `Before returning JSON, privately check cause-and-effect, what the protagonist wants, whether each line follows the last, factual claims, repeated information, shootable visuals, emotional variation, and whether the payoff earns the hook. Rewrite weak or illogical beats; return only the final script.`,
      `- "voice": the narrator voice that best fits the niche and tone, from: ${Object.entries(NARRATOR_VOICES)
        .map(([name, desc]) => `${name} (${desc})`)
        .join(", ")}.${avoidVoices.length ? ` Recently used: ${avoidVoices.join(", ")}; prefer a different one.` : ""}`,
      `- "voiceStyle": 8-24 words directing a performance arc: how to land the hook, where energy rises or relaxes, and the payoff's emotional tone. Never just say "engaging narrator".`,
  ].filter((line) => line !== "");

  const schema = {
      type: "object",
      properties: {
        sentences: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              visual: { type: "string" },
              shot: { type: "string" },
              beat: { type: "string", enum: ["hook", "setup", "build", "escalation", "turn", "payoff"] },
              energy: { type: "string", enum: ["quiet", "curious", "playful", "tense", "surprised", "energized", "relieved", "warm"] },
            },
            required: ["text", "visual", "shot", "beat", "energy"],
          },
        },
        voice: { type: "string" },
        voiceStyle: { type: "string" },
      },
      required: ["sentences", "voice", "voiceStyle"],
  };

  const writeDraft = async (feedback: string[]) => {
    const result = await generateJson<{ sentences: ScriptDraftSentence[]; voice: string; voiceStyle: string }>({
      prompt: [
        ...basePrompt,
        ...(feedback.length
          ? ["", `Your previous draft failed these checks; rewrite the whole script so it passes all of them: ${feedback.join("; ")}.`]
          : []),
      ].join("\n"),
      schema,
    });
    const sentences = (result.sentences ?? [])
      .map((s) => ({
        text: clean(s.text ?? ""),
        visual: clean(s.visual ?? ""),
        shot: clean(s.shot ?? ""),
        beat: s.beat,
        energy: s.energy,
      }))
      .filter((s) => s.text.length > 0);
    const draft = repairScriptDraft({ sentences, voiceStyle: clean(result.voiceStyle ?? "") }, niche.name);
    return { draft, voice: result.voice, issues: validateScriptDraft(draft) };
  };

  // One rewrite with the exact problems listed, inside this run, instead of
  // failing the stage and waiting minutes for a blind retry.
  let attempt = await writeDraft([]);
  if (attempt.issues.length > 0) attempt = await writeDraft(attempt.issues);
  const { sentences, voiceStyle } = attempt.draft;
  if (attempt.issues.length > 0) {
    const words = sentences.reduce((n, s) => n + s.text.split(" ").length, 0);
    throw new Error(`Script failed the story-quality check (${sentences.length} beats, ${words} words): ${attempt.issues.join("; ")}.`);
  }
  const result = { voice: attempt.voice };

  const script: ReelScript = {
    sentences,
    voice: typeof result.voice === "string" && result.voice in NARRATOR_VOICES ? result.voice : GEMINI_DEFAULT_VOICE,
    voiceStyle,
  };
  return { script: script as object };
}
