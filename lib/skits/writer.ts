/**
 * Writes a two-character comedy scene as a directed shot list: who speaks,
 * how they deliver it, how both faces react, where the camera is, and which
 * sounds belong to the moment. Everything downstream (voice, lip sync, cuts,
 * sound) reads from this one plan, so the pieces stay in sync.
 */
import { generateJson } from "@/lib/ai/gemini";
import { NARRATOR_VOICES } from "@/lib/reels/types";
import {
  ACCESSORIES,
  EXPRESSIONS,
  HAIR_STYLES,
  PAUSES,
  SHOTS,
  spokenText,
  type Expression,
  type Skit,
  type SkitCharacter,
  type SkitLine,
} from "./types";

// <long pause> is reserved: it marks turn boundaries for timing (see align.ts).
const TAGS = ["<short pause>", "<sigh>", "<laughs>", "<gasp>", "<scoff>"];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function hex(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function clean(text: unknown): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

export async function writeSkit(params: {
  premise: string;
  niche?: string;
  language?: string;
  avoidTitles?: string[];
}): Promise<Skit> {
  const voices = Object.entries(NARRATOR_VOICES)
    .map(([name, feel]) => `${name} (${feel})`)
    .join(", ");

  const raw = await generateJson<{
    title: string;
    location: { name: string; photoQuery: string; ambience: string };
    characters: { name: string; voice: string; personality: string; look: Record<string, string> }[];
    lines: Record<string, unknown>[];
  }>({
    prompt: [
      `You are a comedy writer and director making a 20-35 second animated vertical skit for Instagram Reels.`,
      `Premise: ${params.premise}`,
      params.niche ? `Niche / audience: ${params.niche}.` : "",
      `Language code: ${params.language ?? "en"}.`,
      params.avoidTitles?.length ? `Don't repeat these recent skits: ${params.avoidTitles.join("; ")}.` : "",
      ``,
      `Write a scene between exactly TWO characters with distinct personalities, 6-12 lines, 60-110 spoken words in total.`,
      `It must feel like two real people reacting to each other, not two voices reading lines:`,
      `- Situational humour: a relatable setup, escalation, then a payoff. Setup -> beat -> punchline. Mix deadpan, awkward pauses and small reactions; not every line is a joke.`,
      `- Write for speech: contractions, fragments, a stammer or trailing off where it fits. Characters reply to what was just said and don't take perfectly equal turns (one short reaction line like "Leo." or "...What?" is great).`,
      `- Inline performance tags are allowed inside "text", sparingly: ${TAGS.join(", ")}. Use a <short pause> inside a line for hesitation.`,
      `- "pauseBefore": the silence before this line starts: "overlap" (cuts in / interrupts), "quick" (snappy comeback), "normal", "beat" (a comic beat, e.g. right before a punchline or after something absurd), "long" (awkward silence). Vary it; timing is where the comedy lives.`,
      `- "style" per line: a specific acting direction (emotion, speed, volume), e.g. "suspicious, slow, like a detective", "panicking, talking fast, then trailing off", "flat deadpan". The same words would be delivered differently depending on this.`,
      `- "expression" (speaker's face) and "listenerExpression" (the other character's face while listening), from: ${EXPRESSIONS.join(", ")}. Reactions sell jokes: the listener's face should react to what they're hearing.`,
      `- "shot": "two-shot" (both in frame, good for setup and back-and-forth), "speaker-close" (close-up on the speaker, for emphasis and punchlines), "listener-reaction" (close-up on the listener's face while the other one talks, for reaction comedy). Vary shots like a directed scene; don't use the same shot 3 times in a row.`,
      `- "beat": "setup", "punchline" or null.`,
      `- "sfx": a 1-3 word sound effect search that matches something actually happening on that line (e.g. "door slam", "phone buzz", "microwave beep", "record scratch"), or null. At most 3 in the whole skit; never random.`,
      `- "location": where it happens. "photoQuery" = 2-3 word stock-photo search for an EMPTY background of that place (e.g. "office kitchen interior", "living room couch"). "ambience" = 2-4 word background sound search matching the place (e.g. "office room tone", "busy cafe ambience").`,
      `- Characters: "voice" from: ${voices}. Two different voices that fit each personality. "look": skin, hair and top as #rrggbb colours (varied, realistic skin tones, clearly different tops), hairStyle from ${HAIR_STYLES.join("/")}, accessory from ${ACCESSORIES.join("/")}.`,
      `No celebrities, brands, real people, politics, or mean-spirited jokes about groups.`,
    ]
      .filter(Boolean)
      .join("\n"),
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        location: {
          type: "object",
          properties: { name: { type: "string" }, photoQuery: { type: "string" }, ambience: { type: "string" } },
          required: ["name", "photoQuery", "ambience"],
        },
        characters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              voice: { type: "string" },
              personality: { type: "string" },
              look: {
                type: "object",
                properties: {
                  skin: { type: "string" },
                  hair: { type: "string" },
                  hairStyle: { type: "string" },
                  top: { type: "string" },
                  accessory: { type: "string" },
                },
                required: ["skin", "hair", "hairStyle", "top", "accessory"],
              },
            },
            required: ["name", "voice", "personality", "look"],
          },
        },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              speaker: { type: "string" },
              text: { type: "string" },
              style: { type: "string" },
              expression: { type: "string" },
              listenerExpression: { type: "string" },
              shot: { type: "string" },
              beat: { type: "string", nullable: true },
              pauseBefore: { type: "string" },
              sfx: { type: "string", nullable: true },
            },
            required: ["speaker", "text", "style", "expression", "listenerExpression", "shot"],
          },
        },
      },
      required: ["title", "location", "characters", "lines"],
    },
  });

  return normalizeSkit(raw);
}

const FALLBACK_LOOKS = [
  { skin: "#f1c27d", hair: "#2b1d14", top: "#e4572e" },
  { skin: "#8d5524", hair: "#111111", top: "#2e86ab" },
];

export function normalizeSkit(raw: {
  title?: string;
  location?: { name?: string; photoQuery?: string; ambience?: string };
  characters?: { name?: string; voice?: string; personality?: string; look?: Record<string, string> }[];
  lines?: Record<string, unknown>[];
}): Skit {
  const voiceNames = Object.keys(NARRATOR_VOICES);
  const chars = (raw.characters ?? []).slice(0, 2);
  if (chars.length < 2) throw new Error("The skit needs two characters.");
  const characters = chars.map((c, i): SkitCharacter => {
    const fb = FALLBACK_LOOKS[i];
    return {
      name: clean(c.name).split(" ")[0] || (i === 0 ? "Maya" : "Leo"),
      voice: pick(c.voice, voiceNames, i === 0 ? "Kore" : "Puck"),
      personality: clean(c.personality),
      look: {
        skin: hex(c.look?.skin, fb.skin),
        hair: hex(c.look?.hair, fb.hair),
        hairStyle: pick(c.look?.hairStyle, HAIR_STYLES, i === 0 ? "ponytail" : "short"),
        top: hex(c.look?.top, fb.top),
        accessory: pick(c.look?.accessory, ACCESSORIES, "none"),
      },
    };
  }) as [SkitCharacter, SkitCharacter];
  if (characters[0].name === characters[1].name) characters[1].name += "2";
  if (characters[0].voice === characters[1].voice) {
    characters[1].voice = voiceNames.find((v) => v !== characters[0].voice) ?? "Puck";
  }

  const names = characters.map((c) => c.name.toLowerCase());
  let sfxCount = 0;
  const lines: SkitLine[] = [];
  for (const l of raw.lines ?? []) {
    // A stray <long pause> inside a line would be mistaken for a turn boundary.
    const text = clean(l.text).replace(/<long pause>/gi, "<short pause>");
    if (!spokenText(text)) continue;
    const speakerRaw = clean(l.speaker).split(" ")[0].toLowerCase();
    const idx = names.indexOf(speakerRaw);
    // Unknown speaker: keep the conversation alternating.
    const speaker = characters[idx >= 0 ? idx : lines.length % 2].name;
    const sfx = typeof l.sfx === "string" && clean(l.sfx) && sfxCount < 3 ? clean(l.sfx) : null;
    if (sfx) sfxCount++;
    lines.push({
      speaker,
      text,
      style: clean(l.style) || "natural, conversational",
      expression: pick(l.expression, EXPRESSIONS, "neutral") as Expression,
      listenerExpression: pick(l.listenerExpression, EXPRESSIONS, "neutral") as Expression,
      shot: pick(l.shot, SHOTS, "two-shot"),
      beat: l.beat === "setup" || l.beat === "punchline" ? l.beat : null,
      pauseBefore: pick(l.pauseBefore, PAUSES, l.beat === "punchline" ? "beat" : "normal"),
      sfx,
    });
  }
  if (lines.length < 2) throw new Error("The skit has fewer than two usable lines.");

  return {
    title: clean(raw.title) || "Untitled skit",
    location: {
      name: clean(raw.location?.name) || "office",
      photoQuery: clean(raw.location?.photoQuery) || "office interior",
      ambience: clean(raw.location?.ambience) || "room tone",
    },
    characters,
    lines,
  };
}
