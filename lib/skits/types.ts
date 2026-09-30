export const EXPRESSIONS = [
  "neutral",
  "happy",
  "laugh",
  "surprised",
  "confused",
  "annoyed",
  "sad",
  "smug",
  "nervous",
  "deadpan",
] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export type Mouth = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "X";

export const HAIR_STYLES = ["short", "long", "bun", "curly", "bald", "spiky", "ponytail"] as const;
export const ACCESSORIES = ["none", "glasses", "beard", "earrings", "cap"] as const;

export interface CharacterLook {
  skin: string;
  hair: string;
  hairStyle: (typeof HAIR_STYLES)[number];
  top: string;
  accessory: (typeof ACCESSORIES)[number];
}

export interface SkitCharacter {
  name: string;
  voice: string;
  personality: string;
  look: CharacterLook;
}

export const SHOTS = ["two-shot", "speaker-close", "listener-reaction"] as const;
export type Shot = (typeof SHOTS)[number];

export const PAUSES = ["overlap", "quick", "normal", "beat", "long"] as const;
/** Silence before a line: a cut-in, a quick reply, normal, a comic beat, an awkward pause. */
export type PauseBefore = (typeof PAUSES)[number];

export interface SkitLine {
  speaker: string;
  text: string;
  style: string;
  expression: Expression;
  listenerExpression: Expression;
  shot: Shot;
  beat: "setup" | "punchline" | null;
  pauseBefore: PauseBefore;
  sfx: string | null;
}

export interface Skit {
  title: string;
  location: {
    name: string;
    photoQuery: string;
    ambience: string;
  };
  characters: [SkitCharacter, SkitCharacter];
  lines: SkitLine[];
}

export const PERFORMANCE_TAG = /<[^>]{1,24}>/g;

export function spokenText(text: string): string {
  return text.replace(PERFORMANCE_TAG, " ").replace(/\s+/g, " ").trim();
}
