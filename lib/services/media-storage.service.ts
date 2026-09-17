import { prisma } from "@/lib/prisma";
import {
  createCompressedThumbnail,
  deleteStoredObject,
  isStorageEnabled,
  fetchToBuffer,
  uploadBuffer,
} from "@/lib/storage";
import { stealthResolvePostMedia } from "@/lib/meta/stealth-engine-bridge";

/**
 * Tiered media storage with a 48-hour heavy-file policy backed by the storage facade (lib/storage — Appwrite or R2).
 * ---------------------------------------------------------------------------
 * Each media row can hold three things:
 *
 *   1. the heavy full-resolution file   (storageUrl / storageFileId)
 *   2. a super-compressed thumbnail     (thumbnailUrl / thumbnailFileId)
 *   3. the original upstream links      (sourceMediaUrl / sourceVideoUrl / permalink)
 *
 * After HEAVY_RETENTION_HOURS the heavy file is deleted from cloud storage to
 * reclaim space, while the row and its thumbnail survive — so the feed still
 * renders, just flagged `isExpired`. The user can then either re-download the
 * full file on demand or wipe the item outright.
 */

export const HEAVY_RETENTION_HOURS = 48;

export interface StoredAssetFields {
  storageUrl: string | null;
  storageFileId: string | null;
  thumbnailUrl: string | null;
  thumbnailFileId: string | null;
  storedAt: Date | null;
  isExpired: boolean;
  expiredAt: Date | null;
}

function heavyCutoff(): Date {
  return new Date(Date.now() - HEAVY_RETENTION_HOURS * 60 * 60 * 1000);
}

/**
 * Uploads the full-resolution asset plus an independently-stored compressed
 * thumbnail to the active storage provider.
 */
export async function uploadHeavyAndThumbnail(params: {
  sourceUrl: string;
  fileNameBase: string;
  folder: string;
  tags?: string[];
  isVideo?: boolean;
  /** Reuse an existing thumbnail instead of regenerating it. */
  existingThumbnail?: { url: string | null; fileId: string | null };
}): Promise<StoredAssetFields | null> {
  if (!isStorageEnabled()) return null;

  const { sourceUrl, fileNameBase, folder, isVideo = false } = params;
  const ext = isVideo ? "mp4" : "jpg";
  const contentType = isVideo ? "video/mp4" : "image/jpeg";

  // Fetch from source CDN
  const buffer = await fetchToBuffer(sourceUrl);
  if (!buffer) return null;

  // Upload heavy file
  const heavy = await uploadBuffer({
    buffer,
    fileName: `${fileNameBase}.${ext}`,
    folder,
    contentType,
  });
  if (!heavy) return null;

  let thumbnailUrl = params.existingThumbnail?.url ?? null;
  let thumbnailFileId = params.existingThumbnail?.fileId ?? null;

  // Generate and upload thumbnail if missing
  if (!thumbnailUrl) {
    const thumb = await createCompressedThumbnail({
      sourceBuffer: buffer,
      fileName: `${fileNameBase}_thumb.jpg`,
      folder: `${folder}/thumbs`,
      isVideo,
    });
    thumbnailUrl = thumb?.url ?? null;
    thumbnailFileId = thumb?.fileId ?? null;
  }

  return {
    storageUrl: heavy.url,
    storageFileId: heavy.fileId,
    thumbnailUrl,
    thumbnailFileId,
    storedAt: new Date(),
    isExpired: false,
    expiredAt: null,
  };
}

/**
 * Deletes heavy originals older than the retention window, keeping each row
 * and its thumbnail.
 */
export async function expireStaleMedia(limit = 200) {
  const stale = await prisma.media.findMany({
    where: {
      isExpired: false,
      storageFileId: { not: null },
      storedAt: { lt: heavyCutoff() },
    },
    select: { id: true, storageFileId: true, thumbnailUrl: true },
    orderBy: { storedAt: "asc" },
    take: limit,
  });

  let expired = 0;
  let failed = 0;

  for (const item of stale) {
    const deleted = item.storageFileId ? await deleteStoredObject(item.storageFileId) : true;
    if (!deleted) {
      failed += 1;
      continue;
    }

    await prisma.media.update({
      where: { id: item.id },
      data: {
        storageUrl: null,
        storageFileId: null,
        isExpired: true,
        expiredAt: new Date(),
      },
    });
    expired += 1;
  }

  return { scanned: stale.length, expired, failed };
}

async function findOwnedMedia(userId: string, mediaId: string) {
  return prisma.media.findFirst({
    where: { id: mediaId, target: { userId } },
    include: { target: { select: { normalizedUsername: true } } },
  });
}

/**
 * Re-fetches the full-resolution file on demand for an expired item.
 */
export async function redownloadMedia(userId: string, mediaId: string) {
  const media = await findOwnedMedia(userId, mediaId);
  if (!media) return { ok: false as const, reason: "not_found" as const };

  const isVideo = media.mediaType === "VIDEO" || media.mediaType === "REEL";
  const folder = `/instascrapper/targets/${media.target.normalizedUsername}/media`;
  const fileNameBase = `${media.target.normalizedUsername}_${media.externalMediaId}`;

  const candidates: Array<{ url: string; video: boolean }> = [];
  if (isVideo && media.sourceVideoUrl) candidates.push({ url: media.sourceVideoUrl, video: true });
  if (media.sourceMediaUrl) candidates.push({ url: media.sourceMediaUrl, video: false });

  // Only the permalink works here: externalMediaId is a numeric pk, not a
  // shortcode, so passing it to the post scraper just burns a 404.
  const resolved = media.permalink ? await stealthResolvePostMedia(media.permalink) : null;
  if (resolved?.videoUrl && isVideo) candidates.unshift({ url: resolved.videoUrl, video: true });
  if (resolved?.imageUrl) {
    candidates.splice(isVideo && resolved.videoUrl ? 1 : 0, 0, {
      url: resolved.imageUrl,
      video: false,
    });
  }

  if (candidates.length === 0) {
    return { ok: false as const, reason: "no_source" as const };
  }

  for (const candidate of candidates) {
    const stored = await uploadHeavyAndThumbnail({
      sourceUrl: candidate.url,
      fileNameBase,
      folder,
      tags: [media.target.normalizedUsername, media.mediaType, "redownload"],
      isVideo: candidate.video,
      existingThumbnail: { url: media.thumbnailUrl, fileId: media.thumbnailFileId },
    });
    if (!stored) continue;

    const updated = await prisma.media.update({
      where: { id: media.id },
      data: {
        ...stored,
        ...(candidate.video
          ? { sourceVideoUrl: candidate.url }
          : { sourceMediaUrl: candidate.url }),
      },
    });

    return { ok: true as const, media: updated, usedVideo: candidate.video };
  }

  return { ok: false as const, reason: "unreachable" as const };
}

/**
 * Wipes an item completely: heavy file, thumbnail, and the database row.
 */
export async function permanentlyDeleteMedia(userId: string, mediaId: string) {
  const media = await findOwnedMedia(userId, mediaId);
  if (!media) return { ok: false as const, reason: "not_found" as const };

  const storageFailures: string[] = [];

  for (const fileId of [media.storageFileId, media.thumbnailFileId]) {
    if (!fileId) continue;
    const deleted = await deleteStoredObject(fileId);
    if (!deleted) storageFailures.push(fileId);
  }

  await prisma.media.delete({ where: { id: media.id } });

  return { ok: true as const, storageFailures };
}
