import { segmentsForSentences } from "@/lib/render/reel";
import { sourcesForNiche } from "@/lib/visuals/niche-sources";
import { searchClips } from "@/lib/visuals/search";
import { clipKey, type StockClip } from "@/lib/visuals/types";
import type { AudioBlueprint, ClipPick, ReelScript, VoiceTiming } from "@/lib/reels/types";
import type { StageContext, StageResult } from "./context";

/** Enough candidates that a rejected clip has real replacements. */
const POOL_TARGET = 6;
const ALTERNATES = 6;

/** The script's own query first, then a shorter version, then the niche itself. */
export function queriesFor(visual: string, niche: string): string[] {
  const short = visual.split(/\s+/).slice(0, 2).join(" ");
  return [...new Set([visual, short, niche].map((q) => q.trim()).filter(Boolean))];
}

export async function runVisualsStage({ project, idea }: StageContext): Promise<StageResult> {
  const script = project.script as ReelScript | null;
  const timing = project.voiceTiming as VoiceTiming | null;
  const blueprint = project.audioBlueprint as AudioBlueprint | null;
  if (!script || !timing) throw new Error("The project has no script or voiceover yet.");

  const routing = sourcesForNiche(idea.niche);
  console.log(`[footage] niche "${idea.niche.name}" -> ${routing.sources.join(", ")}${routing.matched.length ? ` (${routing.matched.join(", ")})` : ""}`);

  const total = blueprint?.durationSec ?? timing.durationSec;
  const segments = segmentsForSentences(timing.spans, total);
  const used = new Set<string>();
  const picks: ClipPick[] = [];

  for (const [i, sentence] of script.sentences.entries()) {
    const needSec = segments[i] ? segments[i].end - segments[i].start : 3;
    const direction = sentence.shot ?? sentence.visual;
    let pool: StockClip[] = [];
    let query = sentence.visual;
    let firstQuery: string | null = null;
    for (const q of queriesFor(sentence.visual, idea.niche.name)) {
      const found = await searchClips(q, {
        niche: idea.niche,
        direction,
        needSec,
        exclude: new Set([...used, ...pool.map(clipKey)]),
      });
      if (found.length && firstQuery === null) firstQuery = q;
      pool = [...pool, ...found];
      if (pool.length >= POOL_TARGET) break;
    }
    if (!pool.length) throw new Error(`No stock footage found for "${sentence.visual}".`);
    query = firstQuery ?? query;

    // Each search is already ranked (title match, fit, length), and earlier queries are
    // the more specific ones, so the pool's order is the ranking.
    used.add(clipKey(pool[0]));
    picks.push({
      sentence: i,
      query,
      direction,
      chosen: pool[0],
      alternates: pool.slice(1, 1 + ALTERNATES),
      approved: false,
      rejected: [],
    });
  }
  return { clips: picks as unknown as object };
}
