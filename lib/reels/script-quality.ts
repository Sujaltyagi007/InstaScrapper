import type { ScriptEnergy, ScriptStoryBeat } from "./types";

export interface ScriptDraftSentence {
  text: string;
  visual: string;
  shot: string;
  beat: ScriptStoryBeat;
  energy: ScriptEnergy;
}

export interface ScriptDraft {
  sentences: ScriptDraftSentence[];
  voiceStyle: string;
}

const BEAT_ORDER: ScriptStoryBeat[] = ["hook", "setup", "build", "escalation", "turn", "payoff"];
const GENERIC_OPENERS = /^(?:today (?:we(?:'re| are) going to|i(?:'m| am) going to)|in this video|welcome back|let's talk about)\b/i;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Fixes the purely mechanical slips in code instead of rejecting the whole
 * script (each rejection costs a Gemini request from a small daily quota):
 * search queries are trimmed or padded to 2-5 words.
 */
export function repairScriptDraft<T extends ScriptDraft>(draft: T, nicheName: string): T {
  const filler = nicheName.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return {
    ...draft,
    sentences: draft.sentences.map((sentence) => {
      let words = sentence.visual.trim().split(/\s+/).filter(Boolean);
      if (words.length > 5) words = words.slice(0, 5);
      if (words.length < 2) words = [...words, ...filler].slice(0, Math.max(2, words.length));
      if (words.length < 2) words = [...words, "scene"];
      return { ...sentence, visual: words.join(" ") };
    }),
  };
}

export function validateScriptDraft(draft: ScriptDraft): string[] {
  const issues: string[] = [];
  const sentences = draft.sentences;
  const words = sentences.reduce((total, sentence) => total + wordCount(sentence.text), 0);

  if (sentences.length < 5 || sentences.length > 9) issues.push("use 5-9 story beats");
  if (words < 55 || words > 105) issues.push("keep narration between 55 and 105 words");
  if (sentences[0] && wordCount(sentences[0].text) > 12) issues.push("keep the hook to 12 words or fewer");
  if (sentences[0] && GENERIC_OPENERS.test(sentences[0].text)) issues.push("replace the generic opening with an immediate hook");

  let lastBeat = -1;
  let lastEnergy: ScriptEnergy | undefined;
  let energyRun = 0;
  const seenBeats = new Set<ScriptStoryBeat>();
  for (const sentence of sentences) {
    const beatIndex = BEAT_ORDER.indexOf(sentence.beat);
    if (beatIndex < 0 || beatIndex < lastBeat) issues.push("keep story beats in hook-to-payoff order");
    if (sentence.beat !== "build" && seenBeats.has(sentence.beat)) issues.push("use each story beat once; only build beats may repeat");
    seenBeats.add(sentence.beat);
    lastBeat = Math.max(lastBeat, beatIndex);
    if (wordCount(sentence.text) > 20) issues.push("break up long spoken beats");
    if (wordCount(sentence.visual) < 2 || wordCount(sentence.visual) > 5) issues.push("use 2-5 searchable words per visual query");
    if (wordCount(sentence.shot) < 8 || wordCount(sentence.shot) > 28) issues.push("give every beat one concise, concrete shot direction");
    energyRun = sentence.energy === lastEnergy ? energyRun + 1 : 1;
    if (energyRun > 2) issues.push("avoid keeping the same emotional energy for three straight beats");
    lastEnergy = sentence.energy;
  }

  if (sentences[0]?.beat !== "hook") issues.push("start with a hook beat");
  if (sentences.at(-1)?.beat !== "payoff") issues.push("end with a payoff beat");
  for (const required of ["setup", "build", "escalation", "turn"] as const) {
    if (!sentences.some((sentence) => sentence.beat === required)) issues.push(`include a ${required} beat`);
  }

  if (new Set(sentences.map((sentence) => sentence.energy)).size < 3) {
    issues.push("vary emotional energy across at least three levels");
  }
  const normalized = sentences.map((sentence) => sentence.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim());
  if (new Set(normalized).size !== normalized.length) issues.push("remove repeated lines");
  if (new Set(sentences.map((sentence) => sentence.visual.toLowerCase())).size !== sentences.length) {
    issues.push("give each beat a distinct visual search");
  }
  if (wordCount(draft.voiceStyle) < 8 || wordCount(draft.voiceStyle) > 32) issues.push("give the narrator a concise, specific delivery arc");

  return [...new Set(issues)];
}