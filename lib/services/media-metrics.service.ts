import { prisma } from "@/lib/prisma";
import type { NormalizedMediaItem } from "@/lib/meta/types";

const SNAPSHOT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function saveMediaMetrics(targetId: string, items: NormalizedMediaItem[]): Promise<number> {
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

    const takenAt = row.timestamp ?? (item.timestamp ? new Date(item.timestamp) : null);
    writes.push(
      prisma.media.update({
        where: { id: row.id },
        data: {
          playCount: m.playCount,
          likeCount: m.likeCount,
          commentCount: m.commentCount,
          audioTitle: m.audioTitle,
          audioArtist: m.audioArtist,
          audioIsOriginal: m.audioIsOriginal,
          metricsUpdatedAt: now,
          // Logged-out scrapes store no timestamp; the feed has the real one.
          ...(row.timestamp === null && takenAt ? { timestamp: takenAt } : {}),
        },
      }),
    );

    const hasCounts = m.playCount !== null || m.likeCount !== null;
    if (hasCounts && takenAt && now.getTime() - takenAt.getTime() <= SNAPSHOT_WINDOW_MS) {
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
