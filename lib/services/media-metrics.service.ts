import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-helpers";
import type { NormalizedMediaItem } from "@/lib/meta/types";

const SNAPSHOT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function saveMediaMetrics(
  targetId: string,
  items: Pick<NormalizedMediaItem, "externalMediaId" | "timestamp" | "metrics">[],
  options: { overrideTimestamp?: boolean; preserveAudio?: boolean; skipSnapshot?: boolean; preserveMissingCounts?: boolean } = {},
): Promise<number> {
  const withMetrics = items.filter((item) => item.metrics);
  if (withMetrics.length === 0) return 0;

  const rows = await prisma.media.findMany({
    where: { targetId, externalMediaId: { in: withMetrics.map((i) => i.externalMediaId) } },
    select: { id: true, externalMediaId: true, timestamp: true },
  });
  const byExternalId = new Map(rows.map((r) => [r.externalMediaId, r]));

  const now = new Date();
  const writes = [];
  for (const item of withMetrics) {
    const row = byExternalId.get(item.externalMediaId);
    const m = item.metrics!;
    if (!row) continue;

    const takenAt = options.overrideTimestamp && item.timestamp
      ? new Date(item.timestamp)
      : row.timestamp ?? (item.timestamp ? new Date(item.timestamp) : null);
    writes.push(
      prisma.media.update({
        where: { id: row.id },
        data: {
          ...(!options.preserveMissingCounts || m.playCount !== null ? { playCount: m.playCount } : {}),
          ...(!options.preserveMissingCounts || m.likeCount !== null ? { likeCount: m.likeCount } : {}),
          ...(!options.preserveMissingCounts || m.commentCount !== null ? { commentCount: m.commentCount } : {}),
          metricsUpdatedAt: now,
          ...(!options.preserveAudio && {
            audioTitle: m.audioTitle,
            audioArtist: m.audioArtist,
            audioIsOriginal: m.audioIsOriginal,
          }),
          // Logged-out scrapes store no timestamp; the feed has the real one.
          ...(takenAt && (row.timestamp === null || options.overrideTimestamp) ? { timestamp: takenAt } : {}),
        },
      }),
    );

    const hasCounts = m.playCount !== null || m.likeCount !== null;
    if (!options.skipSnapshot && hasCounts && takenAt && now.getTime() - takenAt.getTime() <= SNAPSHOT_WINDOW_MS) {
      writes.push(
        prisma.mediaMetricSnapshot.create({
          data: {
            mediaId: row.id,
            playCount: m.playCount,
            likeCount: m.likeCount,
            commentCount: m.commentCount,
            capturedAt: now,
          },
        }),
      );
    }
  }

  if (writes.length > 0) await prisma.$transaction(writes);
  return writes.length;
}

export async function saveManualMediaMetrics(
  userId: string,
  mediaId: string,
  metrics: { playCount: number | null; likeCount: number; commentCount: number; postedAt: Date },
): Promise<void> {
  const media = await prisma.media.findFirst({
    where: {
      id: mediaId,
      isStory: false,
      target: { userId, nicheAccounts: { some: { niche: { userId } } } },
    },
    select: { targetId: true, externalMediaId: true },
  });
  if (!media) throw new ApiError(404, "Niche post not found.");

  await saveMediaMetrics(
    media.targetId,
    [{
      externalMediaId: media.externalMediaId,
      timestamp: metrics.postedAt.toISOString(),
      metrics: {
        playCount: metrics.playCount,
        likeCount: metrics.likeCount,
        commentCount: metrics.commentCount,
        audioTitle: null,
        audioArtist: null,
        audioIsOriginal: null,
      },
    }],
    // Growth history from hand-typed numbers would be noise: a re-save of the
    // same count reads as "stopped growing" and halves the trend score.
    { overrideTimestamp: true, preserveAudio: true, skipSnapshot: true },
  );
}
