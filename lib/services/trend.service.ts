import { prisma } from "@/lib/prisma";
import { scoreTrends, type ScoringMedia, type TrendScore } from "@/lib/trends/scoring";

const MEDIA_PER_ACCOUNT = 40;

export interface TrendCandidate extends TrendScore {
  username: string;
  mediaType: string;
  permalink: string | null;
  caption: string | null;
  timestamp: Date | null;
  audioTitle: string | null;
  audioArtist: string | null;
  audioIsOriginal: boolean | null;
}

/** Reels in the user's niche that are beating their account's usual numbers, best first. */
export async function getTrendCandidates(userId: string): Promise<TrendCandidate[]> {
  const links = await prisma.nicheAccount.findMany({
    where: { niche: { userId } },
    select: { target: { select: { id: true, username: true } } },
  });
  if (links.length === 0) return [];

  const perAccount = await Promise.all(
    links.map(({ target }) =>
      prisma.media.findMany({
        where: {
          targetId: target.id,
          isStory: false,
          OR: [{ playCount: { not: null } }, { likeCount: { not: null } }],
        },
        orderBy: [{ timestamp: "desc" }, { firstSeenAt: "desc" }],
        take: MEDIA_PER_ACCOUNT,
        select: {
          id: true,
          targetId: true,
          mediaType: true,
          permalink: true,
          caption: true,
          timestamp: true,
          playCount: true,
          likeCount: true,
          audioTitle: true,
          audioArtist: true,
          audioIsOriginal: true,
          metricSnapshots: {
            orderBy: { capturedAt: "desc" },
            take: 2,
            select: { capturedAt: true, playCount: true, likeCount: true },
          },
        },
      }),
    ),
  );

  const usernameByTarget = new Map(links.map(({ target }) => [target.id, target.username]));
  const rows = perAccount.flat();
  const byId = new Map(rows.map((r) => [r.id, r]));

  const scoring: ScoringMedia[] = rows.map((r) => ({
    id: r.id,
    accountKey: r.targetId,
    timestamp: r.timestamp,
    playCount: r.playCount,
    likeCount: r.likeCount,
    snapshots: [...r.metricSnapshots].reverse(),
  }));

  return scoreTrends(scoring).map((score) => {
    const r = byId.get(score.id)!;
    return {
      ...score,
      username: usernameByTarget.get(r.targetId) ?? "",
      mediaType: r.mediaType,
      permalink: r.permalink,
      caption: r.caption,
      timestamp: r.timestamp,
      audioTitle: r.audioTitle,
      audioArtist: r.audioArtist,
      audioIsOriginal: r.audioIsOriginal,
    };
  });
}
