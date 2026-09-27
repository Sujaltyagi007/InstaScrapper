import { generateJson } from "@/lib/ai/gemini";
import type { ReelScript } from "@/lib/reels/types";
import type { StageContext, StageResult } from "./context";

const MAX_HASHTAGS = 5;

function hashtag(tag: string): string | null {
  const clean = tag.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return clean.length >= 2 && clean.length <= 40 ? `#${clean.toLowerCase()}` : null;
}

export async function runCaptionStage({ project, idea }: StageContext): Promise<StageResult> {
  const script = project.script as ReelScript | null;
  if (!script) throw new Error("The project has no script.");
  const niche = idea.niche;

  const result = await generateJson<{ hook: string; body: string; cta: string; hashtags: string[] }>({
    prompt: [
      `Write the Instagram caption for this original reel in the niche "${niche.name}". Language code "${niche.language}".`,
      `Reel title: ${idea.title}`,
      `Voiceover: ${script.sentences.map((s) => s.text).join(" ")}`,
      ``,
      `Style: minimal and attractive. Short lines, no walls of text, at most two emojis in total, no clickbait lies.`,
      `Only use facts that are in the voiceover. Don't add numbers, dates or claims that aren't there.`,
      `- "hook": one line that makes people read on; don't just repeat the first spoken line.`,
      `- "body": 1-2 short lines with the takeaway or the most surprising detail from the voiceover.`,
      `- "cta": one short line that invites a comment, save or share (e.g. a question).`,
      `- "hashtags": 3-${MAX_HASHTAGS} relevant hashtags for this niche, mixing broad and specific; no banned or spammy tags like #fyp or #viral.`,
    ].join("\n"),
    schema: {
      type: "object",
      properties: {
        hook: { type: "string" },
        body: { type: "string" },
        cta: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
      },
      required: ["hook", "body", "cta", "hashtags"],
    },
  });

  const caption = [result.hook, result.body, result.cta]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  if (!caption) throw new Error("The caption came back empty.");
  const hashtags = [...new Set((result.hashtags ?? []).map(hashtag).filter((t): t is string => t !== null))].slice(
    0,
    MAX_HASHTAGS,
  );
  return { caption, hashtags };
}
