import { prisma } from "@/lib/prisma";
import { getActiveGraphAccount } from "@/lib/services/meta-connection.service";
import { publishToInstagram } from "@/lib/meta/graph-publish";

const MAX_PER_CHECK = 2;

/** Same rule as the manual repost route: Meta must be able to fetch the URL. */
function publicUrlFor(
  media: {
    storageUrl: string | null;
    sourceMediaUrl: string | null;
    sourceVideoUrl: string | null;
    mediaUrl: string | null;
    videoUrl: string | null;
    thumbnailUrl: string | null;
  },
  isVideo: boolean,
): string | null {
  const candidates = isVideo
    ? [media.storageUrl, media.sourceVideoUrl, media.videoUrl]
    : [media.storageUrl, media.sourceMediaUrl, media.mediaUrl, media.thumbnailUrl];
  for (const url of candidates) {
    if (url && /^https:\/\//i.test(url) && !/localhost|127\.0\.0\.1/i.test(url)) return url;
  }
  return null;
}

export interface AutoRepostResult {
  attempted: number;
  posted: number;
  failed: number;
  skipped: number;
}

export async function autoRepostNewMedia(params: {
  userId: string;
  mediaIds: string[];
}): Promise<AutoRepostResult> {
  const result: AutoRepostResult = { attempted: 0, posted: 0, failed: 0, skipped: 0 };
  if (params.mediaIds.length === 0) return result;

  const account = await getActiveGraphAccount(params.userId);
  if (!account) {
    result.skipped = params.mediaIds.length;
    return result;
  }

  // Oldest first, so a burst is republished in the order it was posted.
  const items = await prisma.media.findMany({
    where: { id: { in: params.mediaIds } },
    orderBy: { timestamp: "asc" },
    take: MAX_PER_CHECK,
  });
  result.skipped += Math.max(0, params.mediaIds.length - items.length);

  for (const media of items) {
    const isVideo = media.mediaType === "VIDEO" || media.mediaType === "REEL" || Boolean(media.videoUrl);

    const already = await prisma.repost.findFirst({
      where: { sourceMediaId: media.id, sessionId: account.igUserId, status: "POSTED" },
      select: { id: true },
    });
    if (already) {
      result.skipped += 1;
      continue;
    }

    const mediaUrl = publicUrlFor(media, isVideo);
    if (!mediaUrl) {
      result.skipped += 1;
      continue;
    }

    result.attempted += 1;
    const caption = media.caption ?? "";
    const repost = await prisma.repost.create({
      data: {
        userId: params.userId,
        sourceMediaId: media.id,
        sessionId: account.igUserId,
        caption,
        status: "PENDING",
      },
    });

    try {
      const published = await publishToInstagram({
        account,
        kind: isVideo ? "REEL" : "IMAGE",
        mediaUrl,
        caption,
        coverUrl: isVideo ? (media.thumbnailUrl ?? undefined) : undefined,
      });
      await prisma.repost.update({
        where: { id: repost.id },
        data: {
          status: published.ok ? "POSTED" : "FAILED",
          instagramMediaId: published.ok ? published.instagramMediaId : null,
          error: published.ok ? null : published.errorMessage,
        },
      });
      if (published.ok) result.posted += 1;
      else result.failed += 1;
    } catch (error) {
      result.failed += 1;
      await prisma.repost.update({
        where: { id: repost.id },
        data: {
          status: "FAILED",
          error: error instanceof Error ? error.message : "auto-repost failed",
        },
      });
    }
  }

  return result;
}
