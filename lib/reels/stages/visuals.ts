import { isPexelsConfigured, searchPortraitClips, type StockClip } from "@/lib/visuals/pexels";
import { segmentsForSentences } from "@/lib/render/reel";
import type { AudioBlueprint, ClipPick, ReelScript, VoiceTiming } from "@/lib/reels/types";
import type { StageContext, StageResult } from "./context";

const RESULTS_PER_QUERY = 8;
const ALTERNATES = 4;

/** The script's own query first, then a shorter version, then the niche itself. */
function queriesFor(visual: string, niche: string): string[] {
  const short = visual.split(/\s+/).slice(0, 2).join(" ");
  return [...new Set([visual, short, niche].map((q) => q.trim()).filter(Boolean))];
}

export async function runVisualsStage({ project, idea }: StageContext): Promise<StageResult> {
  if (!isPexelsConfigured()) throw new Error("PEXELS_API_KEY is not set.");
  const script = project.script as ReelScript | null;
  const timing = project.voiceTiming as VoiceTiming | null;
  const blueprint = project.audioBlueprint as AudioBlueprint | null;
  if (!script || !timing) throw new Error("The project has no script or voiceover yet.");

  const total = blueprint?.durationSec ?? timing.durationSec;
  const segments = segmentsForSentences(timing.spans, total);
  const used = new Set<number>();
  const picks: ClipPick[] = [];

  for (const [i, sentence] of script.sentences.entries()) {
    const needed = segments[i] ? segments[i].end - segments[i].start : 3;
    let fresh: StockClip[] = [];
    let query = sentence.visual;
    for (const q of queriesFor(sentence.visual, idea.niche.name)) {
      fresh = (await searchPortraitClips(q, RESULTS_PER_QUERY)).filter((c) => !used.has(c.id));
      query = q;
      if (fresh.length) break;
    }
    if (!fresh.length) throw new Error(`No stock footage found for "${sentence.visual}".`);

    // Prefer clips long enough to cover the sentence without looping.
    const ranked = [...fresh.filter((c) => c.durationSec >= needed), ...fresh.filter((c) => c.durationSec < needed)];
    used.add(ranked[0].id);
    picks.push({
      sentence: i,
      query,
      chosen: ranked[0],
      alternates: ranked.slice(1, 1 + ALTERNATES),
      approved: false,
      rejected: [],
    });
  }
  return { clips: picks as unknown as object };
}
