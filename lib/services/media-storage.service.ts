import { prisma } from "@/lib/prisma";
import { stealthFetchMediaInfo, stealthResolveEmbedMedia, stealthResolvePostMedia } from "@/lib/meta/stealth-engine-bridge";
import type { MediaChild } from "@/lib/meta/types";
import { nextSessionAvailableAt, pickSession } from "@/lib/meta/session-pool";
import { reportVerdict } from "@/lib/services/media-enrichment.service";
import { createCompressedThumbnail, deleteStoredObject, isStorageEnabled, fetchToBuffer, uploadBuffer, type FileOwner, } from "@/lib/storage";

/** Human label for a scraped post in the file register, e.g. "@nasa reel DdHyaY". */
export function mediaLabel(username: string, mediaType: string, permalink: string | null): string {
  const code = permalink?.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1];
  return `@${username} ${mediaType.toLowerCase()}${code ? ` ${code}` : ""}`;
}

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
  /** File register owner; the thumbnail is recorded as kind THUMBNAIL. */
  owner?: FileOwner;
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
    owner: params.owner,
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
      owner: params.owner,
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
 * Stores a video as the heavy (playable) file with its cover image as the
 * thumbnail. Sharp can't make a thumbnail from a video, so the cover is
 * rendered first and handed over as the existing thumbnail.
 */
export async function uploadVideoWithCover(params: {
  videoUrl: string;
  coverUrl: string | null;
  fileNameBase: string;
  folder: string;
  tags?: string[];
  owner?: FileOwner;
}): Promise<StoredAssetFields | null> {
  const coverBuffer = params.coverUrl ? await fetchToBuffer(params.coverUrl) : null;
  const coverThumb = coverBuffer
    ? await createCompressedThumbnail({
      sourceBuffer: coverBuffer,
      fileName: `${params.fileNameBase}_thumb.jpg`,
      folder: `${params.folder}/thumbs`,
      isVideo: false,
      owner: params.owner,
    })
    : null;
  return uploadHeavyAndThumbnail({
    sourceUrl: params.videoUrl,
    fileNameBase: params.fileNameBase,
    folder: params.folder,
    tags: params.tags,
    isVideo: true,
    existingThumbnail: { url: coverThumb?.url ?? null, fileId: coverThumb?.fileId ?? null },
    owner: params.owner,
  });
}

/**
 * Stores every item of a carousel as MediaAsset rows (position 0 = cover).
 * Stops cleanly when the time budget runs out; items already stored stay, and
 * missing ones can be loaded later from the post (loadFullMedia).
 */
export async function storeCarouselAssets(params: {
  mediaId: string;
  children: { imageUrl: string | null; videoUrl: string | null }[];
  fileNameBase: string;
  folder: string;
  owner?: FileOwner;
  hasTime?: () => boolean;
}): Promise<number> {
  let stored = 0;
  for (const [position, child] of params.children.entries()) {
    if (params.hasTime && !params.hasTime()) break;
    const base = `${params.fileNameBase}_${position + 1}`;
    const file = child.videoUrl
      ? await uploadVideoWithCover({ videoUrl: child.videoUrl, coverUrl: child.imageUrl, fileNameBase: base, folder: params.folder, owner: params.owner })
      : child.imageUrl
        ? await uploadHeavyAndThumbnail({ sourceUrl: child.imageUrl, fileNameBase: base, folder: params.folder, owner: params.owner })
        : null;
    const data = {
      isVideo: Boolean(child.videoUrl),
      sourceUrl: child.videoUrl ?? child.imageUrl,
      storageUrl: file?.storageUrl ?? null,
      storageFileId: file?.storageFileId ?? null,
      thumbnailUrl: file?.thumbnailUrl ?? null,
      thumbnailFileId: file?.thumbnailFileId ?? null,
    };
    await prisma.mediaAsset.upsert({
      where: { mediaId_position: { mediaId: params.mediaId, position } },
      create: { mediaId: params.mediaId, position, ...data },
      update: data,
    });
    if (file) stored += 1;
  }
  return stored;
}

/**
 * Deletes heavy originals older than each user's keep-for setting
 * (User.mediaKeepHours; null = keep until deleted by hand), keeping each row
 * and its thumbnail.
 */
export async function expireStaleMedia(limit = 200) {
  const users = await prisma.user.findMany({
    where: { mediaKeepHours: { not: null } },
    select: { id: true, mediaKeepHours: true },
  });
  const stale: { id: string; storageFileId: string | null; thumbnailUrl: string | null }[] = [];
  for (const user of users) {
    if (stale.length >= limit) break;
    const hours = user.mediaKeepHours ?? HEAVY_RETENTION_HOURS;
    stale.push(
      ...(await prisma.media.findMany({
        where: {
          target: { userId: user.id },
          isExpired: false,
          storageFileId: { not: null },
          storedAt: { lt: new Date(Date.now() - hours * 60 * 60 * 1000) },
        },
        select: { id: true, storageFileId: true, thumbnailUrl: true },
        orderBy: { storedAt: "asc" },
        take: limit - stale.length,
      })),
    );
  }

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
    // A carousel's other items are full-size files too, so they go with it.
    // Rows whose files couldn't be deleted stay, so the next run retries them.
    await deleteMediaAssets(item.id);
    expired += 1;
  }

  return { scanned: stale.length, expired, failed };
}

/**
 * Deletes a post's carousel item files and their rows. Returns the file ids that
 * couldn't be deleted; those rows are kept so a later run retries them.
 */
async function deleteMediaAssets(mediaId: string): Promise<string[]> {
  const assets = await prisma.mediaAsset.findMany({ where: { mediaId } });
  const failures: string[] = [];
  for (const asset of assets) {
    let ok = true;
    for (const fileId of [asset.storageFileId, asset.thumbnailFileId]) {
      if (fileId && !(await deleteStoredObject(fileId))) {
        failures.push(fileId);
        ok = false;
      }
    }
    if (ok) await prisma.mediaAsset.delete({ where: { id: asset.id } });
  }
  return failures;
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
      owner: {
        userId,
        kind: "MEDIA",
        label: mediaLabel(media.target.normalizedUsername, media.mediaType, media.permalink),
        targetId: media.targetId,
        targetUsername: media.target.normalizedUsername,
      },
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

  const storageFailures: string[] = await deleteMediaAssets(media.id);

  for (const fileId of [media.storageFileId, media.thumbnailFileId]) {
    if (!fileId) continue;
    const deleted = await deleteStoredObject(fileId);
    if (!deleted) storageFailures.push(fileId);
  }

  await prisma.media.delete({ where: { id: media.id } });

  return { ok: true as const, storageFailures };
}


export type LoadFullMediaFailure = "not_found" | "not_needed" | "no_burner" | "rate_limited" | "flagged" | "unavailable" | "storage";

function loadFailure(reason: LoadFullMediaFailure, availableAt: Date | null = null) {
  return { ok: false as const, reason, availableAt };
}

type FullMediaSource = {
  videoUrl?: string | null;
  mediaUrl?: string | null;
  children?: MediaChild[] | null;
  mediaType?: string;
};

/**
 * Loads what a logged-out check couldn't store for one post: a reel/video's
 * real file, or every item of a carousel. Instagram's public embed page has
 * both, logged out, so it's tried first; the burner (one logged-in request,
 * through the pool's cap and cooldown) is only the fallback.
 */
export async function loadFullMedia(userId: string, mediaId: string) {
  const media = await findOwnedMedia(userId, mediaId);
  if (!media) return loadFailure("not_found");
  const isVideoKind = media.mediaType === "VIDEO" || media.mediaType === "REEL";
  const isCarousel = media.mediaType === "CAROUSEL_ALBUM";
  if (!isVideoKind && !isCarousel) return loadFailure("not_needed");

  let entry: FullMediaSource | null = null;
  const embed = media.permalink ? await stealthResolveEmbedMedia(media.permalink).catch(() => null) : null;
  if (embed && (isCarousel ? embed.children?.length : embed.videoUrl)) {
    entry = { videoUrl: embed.videoUrl, mediaUrl: embed.imageUrl, children: embed.children };
  } else {
    const picked = await pickSession(userId);
    if (!picked) return loadFailure("no_burner", await nextSessionAvailableAt(userId));
    const lookup = await stealthFetchMediaInfo(media.externalMediaId, picked.config);
    await reportVerdict(picked.id, lookup.verdict, lookup.status);
    if (lookup.verdict === "RATE_LIMITED") return loadFailure("rate_limited");
    if (lookup.verdict === "FLAGGED") return loadFailure("flagged");
    entry = lookup.result?.item ?? null;
  }
  if (!entry) return loadFailure("unavailable");

  const username = media.target.normalizedUsername;
  const fileNameBase = `${username}_${media.externalMediaId}`;
  const folder = `/instascrapper/targets/${username}/media`;
  const owner = {
    userId,
    kind: "MEDIA" as const,
    label: mediaLabel(username, media.mediaType, media.permalink),
    targetId: media.targetId,
    targetUsername: username,
  };

  if (entry.children?.length) {
    const stored = await storeCarouselAssets({ mediaId: media.id, children: entry.children, fileNameBase, folder, owner });
    if (stored === 0) return loadFailure("storage");
  } else if (entry.videoUrl) {
    const stored = media.thumbnailUrl
      ? await uploadHeavyAndThumbnail({
        sourceUrl: entry.videoUrl,
        fileNameBase,
        folder,
        isVideo: true,
        existingThumbnail: { url: media.thumbnailUrl, fileId: media.thumbnailFileId },
        owner,
      })
      : await uploadVideoWithCover({ videoUrl: entry.videoUrl, coverUrl: entry.mediaUrl ?? null, fileNameBase, folder, owner });
    if (!stored) return loadFailure("storage");
    // The heavy file used to be the cover picture; the video replaces it, and
    // the display link moves to the thumbnail so nothing points at a deleted file.
    const previousHeavy = media.storageFileId;
    await prisma.media.update({
      where: { id: media.id },
      data: {
        ...stored,
        mediaType: entry.mediaType === "REEL" ? "REEL" : media.mediaType,
        mediaUrl: stored.thumbnailUrl ?? media.sourceMediaUrl,
        videoUrl: entry.videoUrl,
        sourceVideoUrl: entry.videoUrl,
      },
    });
    if (previousHeavy && previousHeavy !== stored.storageFileId && previousHeavy !== stored.thumbnailFileId) {
      await deleteStoredObject(previousHeavy);
    }
  } else {
    return loadFailure("unavailable");
  }

  const updated = await prisma.media.findUniqueOrThrow({
    where: { id: media.id },
    include: { assets: { orderBy: { position: "asc" } } },
  });
  return { ok: true as const, media: updated };
}
