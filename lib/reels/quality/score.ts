import { clipKey } from "@/lib/visuals/types";
import type { Segment } from "@/lib/render/reel";
import type { RenderMeasurements } from "./measure";
import type { CaptionStyle } from "@/lib/render/captions";
import type { CaptionCue, Span } from "@/lib/render/timing";
import type { ClipPick, ScriptStoryBeat } from "@/lib/reels/types";

export type Dimension = "hook" | "retention" | "visual" | "audio" | "readability" | "originality";

export const DIMENSION_WEIGHTS: Record<Dimension, number> = {
  hook: 20,
  retention: 20,
  visual: 15,
  audio: 15,
  readability: 15,
  originality: 15,
};

export const SHIP_SCORE = 80;
export const FIX_SCORE = 65;

export interface QualityCheck {
  id: string;
  dimension: Dimension;
  label: string;
  score: number | null;
  weight: number;
  detail: string;
}

export interface QualityGate {
  id: string;
  label: string;
  passed: boolean | null;
  detail: string;
}

export interface QualityReport {
  version: 1;
  score: number;
  verdict: "READY" | "FIXABLE" | "WEAK" | "BLOCKED";
  dimensions: Record<Dimension, { score: number | null; weight: number }>;
  gates: QualityGate[];
  checks: QualityCheck[];
  failing: string[];
  aiDisclosure: boolean;
  measuredAt: string;
}

export interface QualityInput {
  durationSec: number;
  spans: Span[];
  segments: Segment[];
  cues: CaptionCue[];
  captionStyle: Pick<CaptionStyle, "width" | "height" | "marginBottom" | "fontSize">;
  sentences: { text: string; beat?: ScriptStoryBeat }[];
  picks: ClipPick[];
  measured: Partial<RenderMeasurements>;
  recentClipKeys: ReadonlySet<string>;
  recentHookOpenings: readonly string[];
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const band = (value: number, lo: number, hi: number, slack: number) =>
  value < lo ? clamp01(1 - (lo - value) / slack) : value > hi ? clamp01(1 - (value - hi) / slack) : 1;
const lowerIsBetter = (value: number, good: number, bad: number) => clamp01((bad - value) / (bad - good));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const sec = (n: number) => `${(Math.round(n * 10) / 10).toString()}s`;

const BEAT_ORDER: ScriptStoryBeat[] = ["hook", "setup", "build", "escalation", "turn", "payoff"];
const OUTRO = /\b(follow|subscribe|like and|thanks for watching|see you next)\b/i;

export function openingOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
}

function gates(input: QualityInput): QualityGate[] {
  const { picks, measured } = input;
  const missingLicence = picks.filter((p) => !p.chosen.license || !p.chosen.pageUrl || p.chosen.id === undefined);
  const unchecked = picks.filter((p) => !p.approved);
  const peak = measured.truePeakDb;
  return [
    {
      id: "licence-record",
      label: "Every clip has a licence record",
      passed: missingLicence.length === 0,
      detail:
        missingLicence.length === 0
          ? `${picks.length} clips, each with source, licence and page link.`
          : `${missingLicence.length} clip(s) have no licence or source page saved.`,
    },
    {
      id: "no-watermark",
      label: "No third-party watermark or logo",
      passed: unchecked.length === 0,
      detail:
        unchecked.length === 0
          ? "Every clip passed the visual safety review (no on-frame OCR yet)."
          : `${unchecked.length} clip(s) never passed the safety review.`,
    },
    {
      id: "claims-signed-off",
      label: "Flagged factual claims signed off",
      passed: null,
      detail: "Claim extraction isn't built yet; check the facts yourself before posting.",
    },
    {
      id: "ai-disclosure",
      label: "AI label set for the synthetic voice",
      passed: true,
      detail: "The narrator is an AI voice, so turn on Instagram's “AI info” label when posting.",
    },
    {
      id: "true-peak",
      label: "Audio true peak at or below −1 dBTP",
      passed: peak === undefined ? null : peak <= -1,
      detail: peak === undefined ? "Not measured." : `True peak ${peak.toFixed(1)} dBTP.`,
    },
  ];
}

function checks(input: QualityInput): QualityCheck[] {
  const { spans, segments, cues, sentences, picks, measured, captionStyle } = input;
  const out: QualityCheck[] = [];
  const add = (id: string, dimension: Dimension, label: string, weight: number, score: number | null, detail: string) =>
    out.push({ id, dimension, label, weight, score: score === null ? null : clamp01(score), detail });

  const firstWord = spans[0]?.start;
  add("hook-speech", "hook", "Voice starts by 0.5 s", 3, firstWord === undefined ? null : lowerIsBetter(firstWord, 0.5, 1.5), firstWord === undefined ? "No voice timing." : `First word at ${sec(firstWord)}.`);
  const firstText = cues[0]?.start;
  add("hook-text", "hook", "On-screen text by 0.5 s", 2, firstText === undefined ? null : lowerIsBetter(firstText, 0.5, 1.5), firstText === undefined ? "No captions." : `First caption at ${sec(firstText)}.`);
  const firstCut = segments.length > 1 ? segments[0].end : undefined;
  add("hook-visual-change", "hook", "Picture changes by 1 s", 2, firstCut === undefined ? null : lowerIsBetter(firstCut, 1.0, 3.0), firstCut === undefined ? "Single shot." : `First cut at ${sec(firstCut)}.`);
  const hookLine = sentences[0]?.text ?? "";
  const hookWords = hookLine.split(/\s+/).filter(Boolean).length;
  add("hook-length", "hook", "Hook line is short (up to 14 words)", 1, hookWords === 0 ? null : lowerIsBetter(hookWords, 14, 24), `${hookWords} words.`,);

  const lengths = segments.map((s) => s.end - s.start);
  if (lengths.length > 0) {
    const med = median(lengths);
    add("shot-median", "retention", "Median shot 1.5-3 s", 3, band(med, 1.5, 3.0, 2.0), `Median shot ${sec(med)}.`);
    const longest = Math.max(...lengths);
    add("shot-longest", "retention", "No shot over 4 s", 2, lowerIsBetter(longest, 4, 8), `Longest shot ${sec(longest)}.`);
  }
  const beats = sentences.map((s) => s.beat).filter((b): b is ScriptStoryBeat => Boolean(b));
  if (beats.length === sentences.length && beats.length > 0) {
    const idx = beats.map((b) => BEAT_ORDER.indexOf(b));
    const inOrder = idx.every((v, i) => i === 0 || v >= idx[i - 1]);
    add("beat-order", "retention", "Story beats in order", 2, inOrder ? 1 : 0.3, inOrder ? "Hook to payoff in order." : "Beats are out of order.");
    const endsOnPayoff = beats[beats.length - 1] === "payoff";
    add("ends-on-payoff", "retention", "Ends on the payoff", 1, endsOnPayoff ? 1 : 0.4, endsOnPayoff ? "Last line is the payoff." : "Last line isn't marked payoff.");
  }
  const last = sentences[sentences.length - 1]?.text ?? "";
  add("no-outro", "retention", "No “follow for more” outro", 1, OUTRO.test(last) ? 0 : 1, OUTRO.test(last) ? "The last line asks viewers to leave." : "No outro line.");
  add("length", "retention", "Length 15-45 s", 1, band(input.durationSec, 15, 45, 20), `Runs ${sec(input.durationSec)}.`);

  if (measured.width !== undefined && measured.height !== undefined) {
    const ok = measured.width === 1080 && measured.height === 1920;
    add("resolution", "visual", "1080 × 1920", 2, ok ? 1 : 0, `${measured.width}×${measured.height}.`);
  }
  if (measured.blackSec !== undefined) {
    add("black-frames", "visual", "No black frames", 2, lowerIsBetter(measured.blackSec, 0.2, 1.0), `${sec(measured.blackSec)} of black.`);
  }
  if (measured.frozenSec !== undefined) {
    add("frozen-frames", "visual", "No frozen picture", 2, lowerIsBetter(measured.frozenSec, 0.5, 2.5), `${sec(measured.frozenSec)} frozen.`);
  }
  if (picks.length > 0) {
    const loose = picks.filter((p) => p.fallback && p.chosen.id === p.fallback.id && p.chosen.source === p.fallback.source);
    add("clip-fit", "visual", "Clips fit their sentences", 2, 1 - loose.length / picks.length, loose.length === 0 ? "No loosely-fitting clips." : `${loose.length} of ${picks.length} clips only loosely fit.`);
  }
  if (measured.loudnessLufs !== undefined) {
    add("loudness", "audio", "Loudness −14 ± 1 LUFS", 4, band(measured.loudnessLufs, -15, -13, 4), `${measured.loudnessLufs.toFixed(1)} LUFS.`);
  }
  if (measured.truePeakDb !== undefined) {
    add("true-peak", "audio", "No clipping", 2, lowerIsBetter(measured.truePeakDb, -1.5, 0), `True peak ${measured.truePeakDb.toFixed(1)} dBTP.`);
  }

  if (cues.length > 0) {
    const fast = cues.filter((c) => c.text.length / Math.max(0.05, c.end - c.start) > 20);
    add("caption-speed", "readability", "At most 20 characters per second", 3, 1 - fast.length / cues.length, fast.length === 0 ? "Every caption is readable at speed." : `${fast.length} of ${cues.length} captions flash by too fast.`,);
    const words = Math.max(...cues.map((c) => c.text.split(/\s+/).filter(Boolean).length));
    add("caption-words", "readability", "2-5 words per caption", 1, words <= 5 ? 1 : 0.4, `Up to ${words} words.`);
    const bottomFraction = captionStyle.marginBottom / captionStyle.height;
    add("caption-safe-zone", "readability", "Captions clear of Instagram's bottom 35 %", 3, bottomFraction >= 0.35 ? 1 : lowerIsBetter(0.35 - bottomFraction, 0.02, 0.15), `Caption bottom sits ${(bottomFraction * 100).toFixed(0)} % up from the edge.`);
    add("caption-contrast", "readability", "Text contrast 4.5:1", 1, 1, "White text with a black outline.");
  }
  if (picks.length > 0) {
    const reused = picks.filter((p) => input.recentClipKeys.has(clipKey(p.chosen)));
    add("clip-reuse", "originality", "No clip reused from the last 30 reels", 3, 1 - reused.length / picks.length, reused.length === 0 ? "All clips are new for this account." : `${reused.length} of ${picks.length} clips were used in a recent reel.`,
    );
  }
  const opening = openingOf(hookLine);
  if (opening) {
    const repeated = input.recentHookOpenings.includes(opening);
    add("hook-repeat", "originality", "Hook opening not used in the last 10", 2, repeated ? 0 : 1, repeated ? `A recent reel also opened with “${opening}”.` : "Fresh opening.");
  }

  return out;
}

export function scoreReel(input: QualityInput): QualityReport {
  const allChecks = checks(input);
  const allGates = gates(input);

  const dimensions = {} as QualityReport["dimensions"];
  let weighted = 0;
  let usedWeight = 0;
  for (const dim of Object.keys(DIMENSION_WEIGHTS) as Dimension[]) {
    const scored = allChecks.filter((c) => c.dimension === dim && c.score !== null);
    const total = scored.reduce((n, c) => n + c.weight, 0);
    const score = total > 0 ? scored.reduce((n, c) => n + c.score! * c.weight, 0) / total : null;
    dimensions[dim] = { score: score === null ? null : Math.round(score * 100) / 100, weight: DIMENSION_WEIGHTS[dim] };
    if (score !== null) {
      weighted += score * DIMENSION_WEIGHTS[dim];
      usedWeight += DIMENSION_WEIGHTS[dim];
    }
  }
  const score = usedWeight > 0 ? Math.round((weighted / usedWeight) * 100) : 0;
  const blocked = allGates.some((g) => g.passed === false);

  return {
    version: 1,
    score,
    verdict: blocked ? "BLOCKED" : score >= SHIP_SCORE ? "READY" : score >= FIX_SCORE ? "FIXABLE" : "WEAK",
    dimensions,
    gates: allGates,
    checks: allChecks,
    failing: allChecks
      .filter((c) => c.score !== null && c.score < 0.7)
      .sort((a, b) => a.score! * a.weight - b.score! * b.weight)
      .map((c) => `${c.label}: ${c.detail}`),
    aiDisclosure: true,
    measuredAt: new Date().toISOString(),
  };
}
