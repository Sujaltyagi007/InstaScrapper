import { prisma } from "@/lib/prisma";
import { clipKey } from "@/lib/visuals/types";
import type { Segment } from "@/lib/render/reel";
import { measureRender } from "./measure";
import { DEFAULT_CAPTION_STYLE } from "@/lib/render/captions";
import type { CaptionCue, Span } from "@/lib/render/timing";
import type { ClipPick, ReelScript } from "@/lib/reels/types";
import { openingOf, scoreReel, type QualityReport } from "./score";

interface EvaluateArgs {
  projectId: string;
  userId: string;
  workDir: string;
  file: string;
  script: ReelScript;
  picks: ClipPick[];
  spans: Span[];
  segments: Segment[];
  cues: CaptionCue[];
  durationSec: number;
}

/** Measures the render in `workDir` and scores it against this account's recent reels. */
export async function evaluateRender(args: EvaluateArgs): Promise<QualityReport> {
  const [measured, recent] = await Promise.all([
    measureRender(args.workDir, args.file),
    prisma.reelProject.findMany({
      where: { userId: args.userId, id: { not: args.projectId } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { clips: true, script: true },
    }),
  ]);

  const recentClipKeys = new Set<string>();
  const recentHookOpenings: string[] = [];
  recent.forEach((p, i) => {
    for (const pick of (p.clips as unknown as ClipPick[] | null) ?? []) {
      if (pick?.chosen) recentClipKeys.add(clipKey(pick.chosen));
    }
    const first = (p.script as unknown as ReelScript | null)?.sentences?.[0]?.text;
    if (i < 10 && first) recentHookOpenings.push(openingOf(first));
  });

  return scoreReel({
    durationSec: args.durationSec,
    spans: args.spans,
    segments: args.segments,
    cues: args.cues,
    captionStyle: DEFAULT_CAPTION_STYLE,
    sentences: args.script.sentences,
    picks: args.picks,
    measured,
    recentClipKeys,
    recentHookOpenings,
  });
}
