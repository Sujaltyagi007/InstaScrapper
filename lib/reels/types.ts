import type { Span } from "@/lib/render/timing";
import type { StockClip } from "@/lib/visuals/pexels";

/** Stages in order. The pipeline only runs stages that have a handler; the rest wait. */
export const REEL_STAGES = [
  "SCRIPT",
  "VOICE",
  "AUDIO_PLAN",
  "VISUALS",
  "SAFETY",
  "RENDER",
  "CAPTION",
  "READY",
  "POSTED",
] as const;
export type ReelStage = (typeof REEL_STAGES)[number] | "FAILED";

export function nextStage(stage: ReelStage): ReelStage {
  const i = REEL_STAGES.indexOf(stage as (typeof REEL_STAGES)[number]);
  return i >= 0 && i < REEL_STAGES.length - 1 ? REEL_STAGES[i + 1] : stage;
}

export interface ScriptSentence {
  text: string;
  /** Stock-footage search query for what's on screen during this sentence. */
  visual: string;
}

export interface ReelScript {
  sentences: ScriptSentence[];
  voice: string;
  voiceStyle: string;
}

export interface VoiceTiming {
  durationSec: number;
  /** One span per script sentence, in seconds, in the stored (tightened) voice file. */
  spans: Span[];
}

export interface AudioBlueprint {
  /** What the trending audio feels like. `listened` = Gemini heard it; `inferred` = guessed from text. */
  reference: {
    basis: "listened" | "inferred";
    genre: string;
    mood: string[];
    bpm: number | null;
    energy: "low" | "medium" | "high";
    notes: string;
  };
  music: { id: string; title: string; startSec: number; bpm?: number | null } | null;
  sfx: { id: string; title: string; sentence: number; at: "start" | "end"; atSec: number }[];
  durationSec: number;
}

/**
 * Gemini TTS voices the script writer may choose from. A curated subset: all
 * clear enough for narration. Unknown names fall back to the default voice.
 */
export const NARRATOR_VOICES: Record<string, string> = {
  Kore: "firm, confident",
  Puck: "upbeat, lively",
  Charon: "informative, calm",
  Fenrir: "excitable, energetic",
  Aoede: "breezy, relaxed",
  Leda: "youthful, bright",
  Orus: "firm, deep",
  Zephyr: "bright, clear",
  Sadaltager: "knowledgeable, measured",
  Achird: "friendly, warm",
  Gacrux: "mature, authoritative",
  Sulafat: "warm, soft",
};

/** The footage chosen for one script sentence. */
export interface ClipPick {
  sentence: number;
  query: string;
  chosen: StockClip;
  /** Next-best search results, used when the chosen clip fails the safety check. */
  alternates: StockClip[];
  /** Passed the visual safety check. */
  approved: boolean;
  rejected: { id: number; reason: string }[];
}
