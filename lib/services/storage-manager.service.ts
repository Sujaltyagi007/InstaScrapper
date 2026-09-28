/**
 * The Storage page's backend: what a user has in storage, grouped, and the
 * ways to remove it. Every delete also clears the database fields that pointed
 * at the file, so nothing in the app shows a broken image afterwards.
 */
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-helpers";
import { deleteStoredObject, getStoredObjectInfo, type StoredFileKind } from "@/lib/storage";
import { mediaLabel } from "@/lib/services/media-storage.service";

/** Appwrite's free plan: 2 GB. Override when on another plan or provider. */
export function storageQuotaBytes(): number {
  const n = Number(process.env.STORAGE_QUOTA_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 2 * 1024 ** 3;
}

const DELETE_CONCURRENCY = 8;
const PAGE_SIZE = 60;
export const MEDIA_KEEP_OPTIONS = [48, 168, 720] as const;

interface Ref {
  fileId: string;
  url: string;
  kind: StoredFileKind;
  label: string;
  targetId?: string | null;
  targetUsername?: string | null;
}

/**
 * Registers files the app references but the register doesn't know yet
 * (anything uploaded before the register existed, or a failed record). Sizes
 * come from the provider; references to files that no longer exist are skipped.
 */
export async function syncStoredFiles(userId: string): Promise<number> {
  const [media, snapshots, reels, sounds, known] = await Promise.all([
    prisma.media.findMany({
      where: { target: { userId }, OR: [{ storageFileId: { not: null } }, { thumbnailFileId: { not: null } }] },
      select: {
        targetId: true,
        storageFileId: true,
        storageUrl: true,
        thumbnailFileId: true,
        thumbnailUrl: true,
        isStory: true,
        mediaType: true,
        permalink: true,
        target: { select: { normalizedUsername: true } },
      },
    }),
    prisma.targetSnapshot.findMany({
      where: { target: { userId }, profilePictureStorageId: { not: null } },
      select: {
        targetId: true,
        profilePictureStorageId: true,
        profilePictureStorageUrl: true,
        target: { select: { normalizedUsername: true } },
      },
    }),
    prisma.reelProject.findMany({
      where: { userId },
      select: {
        voiceFileId: true,
        voiceUrl: true,
        mixFileId: true,
        mixUrl: true,
        renderFileId: true,
        renderUrl: true,
        coverFileId: true,
        coverUrl: true,
        idea: { select: { title: true } },
      },
    }),
    prisma.soundAsset.findMany({ where: { userId }, select: { storageFileId: true, storageUrl: true, title: true, kind: true } }),
    prisma.storedFile.findMany({ where: { userId }, select: { fileId: true } }),
  ]);

  const refs: Ref[] = [];
  for (const m of media) {
    const username = m.target.normalizedUsername;
    const base = { targetId: m.targetId, targetUsername: username };
    if (m.storageFileId && m.storageUrl) {
      refs.push({
        ...base,
        fileId: m.storageFileId,
        url: m.storageUrl,
        kind: m.isStory ? "STORY" : "MEDIA",
        label: m.isStory ? `@${username} story` : mediaLabel(username, m.mediaType, m.permalink),
      });
    }
    if (m.thumbnailFileId && m.thumbnailUrl) {
      refs.push({ ...base, fileId: m.thumbnailFileId, url: m.thumbnailUrl, kind: "THUMBNAIL", label: `${mediaLabel(username, m.mediaType, m.permalink)} (thumbnail)` });
    }
  }
  for (const s of snapshots) {
    if (!s.profilePictureStorageUrl) continue;
    const username = s.target.normalizedUsername;
    refs.push({
      fileId: s.profilePictureStorageId!,
      url: s.profilePictureStorageUrl,
      kind: "PROFILE_PIC",
      label: `@${username} profile picture`,
      targetId: s.targetId,
      targetUsername: username,
    });
  }
  for (const r of reels) {
    const parts: [string | null, string | null, string][] = [
      [r.voiceFileId, r.voiceUrl, "voiceover"],
      [r.mixFileId, r.mixUrl, "mixed audio"],
      [r.renderFileId, r.renderUrl, "video"],
      [r.coverFileId, r.coverUrl, "cover"],
    ];
    for (const [fileId, url, part] of parts) {
      if (fileId && url) refs.push({ fileId, url, kind: "REEL", label: `Reel "${r.idea.title}": ${part}` });
    }
  }
  for (const s of sounds) {
    refs.push({
      fileId: s.storageFileId,
      url: s.storageUrl,
      kind: "SOUND",
      label: `${s.kind === "MUSIC" ? "Music" : "Sound effect"}: ${s.title}`,
    });
  }

  const knownIds = new Set(known.map((k) => k.fileId));
  const missing = [...new Map(refs.filter((r) => !knownIds.has(r.fileId)).map((r) => [r.fileId, r])).values()];
  if (missing.length === 0) return 0;

  const info = await getStoredObjectInfo(missing.map((r) => r.fileId));
  const rows = missing
    .filter((r) => info.has(r.fileId))
    .map((r) => {
      const i = info.get(r.fileId)!;
      return {
        userId,
        fileId: r.fileId,
        url: r.url,
        kind: r.kind,
        label: r.label.slice(0, 200),
        targetId: r.targetId ?? null,
        targetUsername: r.targetUsername ?? null,
        contentType: i.mimeType,
        sizeBytes: i.sizeBytes,
        createdAt: new Date(i.createdAt),
      };
    });
  if (rows.length) await prisma.storedFile.createMany({ data: rows, skipDuplicates: true });
  return rows.length;
}

/** Group key: "t:<targetId>", "u:<username>" (deleted target), "reels", "sounds", "other". */
function groupKeyOf(f: { kind: string; targetId: string | null; targetUsername: string | null }): string {
  if (f.kind === "REEL") return "reels";
  if (f.kind === "SOUND") return "sounds";
  if (f.targetId) return `t:${f.targetId}`;
  if (f.targetUsername) return `u:${f.targetUsername}`;
  return "other";
}

function groupWhere(userId: string, key: string) {
  if (key === "reels") return { userId, kind: "REEL" };
  if (key === "sounds") return { userId, kind: "SOUND" };
  if (key.startsWith("t:")) return { userId, targetId: key.slice(2) };
  if (key.startsWith("u:")) return { userId, targetId: null, targetUsername: key.slice(2), kind: { notIn: ["REEL", "SOUND"] } };
  if (key === "other") return { userId, targetId: null, targetUsername: null, kind: { notIn: ["REEL", "SOUND"] } };
  throw new ApiError(400, "Unknown file group.");
}

export async function getStorageOverview(userId: string) {
  const newlyRegistered = await syncStoredFiles(userId);
  const [files, user, targets] = await Promise.all([
    prisma.storedFile.findMany({
      where: { userId },
      select: { kind: true, targetId: true, targetUsername: true, sizeBytes: true },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mediaKeepHours: true } }),
    prisma.target.findMany({ where: { userId }, select: { id: true, normalizedUsername: true } }),
  ]);
  const usernames = new Map(targets.map((t) => [t.id, t.normalizedUsername]));

  const groups = new Map<
    string,
    { key: string; label: string; deletedTarget: boolean; files: number; bytes: number; byKind: Record<string, { files: number; bytes: number }> }
  >();
  let totalBytes = 0;
  for (const f of files) {
    const key = groupKeyOf(f);
    let group = groups.get(key);
    if (!group) {
      const label =
        key === "reels"
          ? "Reels"
          : key === "sounds"
            ? "Sound bank"
            : key === "other"
              ? "Other files"
              : `@${key.startsWith("t:") ? (usernames.get(key.slice(2)) ?? f.targetUsername ?? "unknown") : key.slice(2)}`;
      group = { key, label, deletedTarget: key.startsWith("u:"), files: 0, bytes: 0, byKind: {} };
      groups.set(key, group);
    }
    const size = f.sizeBytes ?? 0;
    group.files += 1;
    group.bytes += size;
    const k = (group.byKind[f.kind] ??= { files: 0, bytes: 0 });
    k.files += 1;
    k.bytes += size;
    totalBytes += size;
  }

  return {
    totalFiles: files.length,
    totalBytes,
    quotaBytes: storageQuotaBytes(),
    mediaKeepHours: user.mediaKeepHours,
    newlyRegistered,
    groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes),
  };
}

export async function listGroupFiles(userId: string, key: string, page = 0) {
  const where = groupWhere(userId, key);
  const [files, total] = await Promise.all([
    prisma.storedFile.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { fileId: true, url: true, kind: true, label: true, contentType: true, sizeBytes: true, createdAt: true },
    }),
    prisma.storedFile.count({ where }),
  ]);
  return { files, total, page, pageSize: PAGE_SIZE };
}

/**
 * Deletes files the user owns and clears every field that pointed at them:
 * a scraped post keeps its row and thumbnail (marked expired, can be
 * re-downloaded), a reel loses that part, a sound leaves the sound bank.
 */
export async function deleteUserFiles(userId: string, fileIds: string[]): Promise<{ deleted: number; failed: number }> {
  const owned = await prisma.storedFile.findMany({
    where: { userId, fileId: { in: [...new Set(fileIds)] } },
    select: { fileId: true },
  });
  const done: string[] = [];
  let failed = 0;
  for (let i = 0; i < owned.length; i += DELETE_CONCURRENCY) {
    const batch = owned.slice(i, i + DELETE_CONCURRENCY);
    const results = await Promise.all(batch.map((f) => deleteStoredObject(f.fileId)));
    results.forEach((ok, j) => (ok ? done.push(batch[j].fileId) : (failed += 1)));
  }
  if (done.length === 0) return { deleted: 0, failed };

  const now = new Date();
  const ids = { in: done };
  await prisma.$transaction([
    prisma.media.updateMany({
      where: { target: { userId }, storageFileId: ids },
      data: { storageUrl: null, storageFileId: null, isExpired: true, expiredAt: now },
    }),
    prisma.media.updateMany({ where: { target: { userId }, thumbnailFileId: ids }, data: { thumbnailUrl: null, thumbnailFileId: null } }),
    // A carousel item whose file is gone has nothing left to show.
    prisma.mediaAsset.deleteMany({ where: { media: { target: { userId } }, storageFileId: ids } }),
    prisma.mediaAsset.updateMany({ where: { media: { target: { userId } }, thumbnailFileId: ids }, data: { thumbnailUrl: null, thumbnailFileId: null } }),
    prisma.targetSnapshot.updateMany({
      where: { target: { userId }, profilePictureStorageId: ids },
      data: { profilePictureStorageId: null, profilePictureStorageUrl: null },
    }),
    prisma.reelProject.updateMany({ where: { userId, voiceFileId: ids }, data: { voiceFileId: null, voiceUrl: null } }),
    prisma.reelProject.updateMany({ where: { userId, mixFileId: ids }, data: { mixFileId: null, mixUrl: null } }),
    prisma.reelProject.updateMany({ where: { userId, renderFileId: ids }, data: { renderFileId: null, renderUrl: null } }),
    prisma.reelProject.updateMany({ where: { userId, coverFileId: ids }, data: { coverFileId: null, coverUrl: null } }),
    prisma.soundAsset.deleteMany({ where: { userId, storageFileId: ids } }),
    // deleteStoredObject already forgets each file; this covers a register row it couldn't remove.
    prisma.storedFile.deleteMany({ where: { userId, fileId: ids } }),
  ]);
  return { deleted: done.length, failed };
}

/** Deletes a whole group, or only some kinds in it (e.g. just the full-size files of one account). */
export async function deleteGroupFiles(userId: string, key: string, kinds?: StoredFileKind[]) {
  const rows = await prisma.storedFile.findMany({
    where: { ...groupWhere(userId, key), ...(kinds?.length ? { kind: { in: kinds } } : {}) },
    select: { fileId: true },
  });
  return deleteUserFiles(userId, rows.map((r) => r.fileId));
}

/** All files of one target (register synced first, so nothing is missed). */
export async function deleteTargetFiles(userId: string, targetId: string) {
  await syncStoredFiles(userId);
  return deleteGroupFiles(userId, `t:${targetId}`);
}

export async function countTargetFiles(userId: string, targetId: string) {
  await syncStoredFiles(userId);
  const agg = await prisma.storedFile.aggregate({
    where: { userId, targetId },
    _count: { _all: true },
    _sum: { sizeBytes: true },
  });
  return { files: agg._count._all, bytes: agg._sum.sizeBytes ?? 0 };
}

/**
 * Old profile-picture copies: keeps each account's current picture (the one
 * its latest snapshot shows) and deletes the rest. Before the register, a new
 * copy was uploaded on every check.
 */
export async function cleanupProfilePictures(userId: string) {
  await syncStoredFiles(userId);
  const pics = await prisma.storedFile.findMany({
    where: { userId, kind: "PROFILE_PIC" },
    select: { fileId: true, targetId: true },
  });
  const targetIds = [...new Set(pics.map((p) => p.targetId).filter((t): t is string => t !== null))];
  const keep = new Set<string>();
  for (const targetId of targetIds) {
    const latest = await prisma.targetSnapshot.findFirst({
      where: { targetId, profilePictureStorageId: { not: null } },
      orderBy: { capturedAt: "desc" },
      select: { profilePictureStorageId: true },
    });
    if (latest?.profilePictureStorageId) keep.add(latest.profilePictureStorageId);
  }
  return deleteUserFiles(userId, pics.filter((p) => !keep.has(p.fileId)).map((p) => p.fileId));
}

export async function setMediaKeepHours(userId: string, hours: number | null) {
  if (hours !== null && !(MEDIA_KEEP_OPTIONS as readonly number[]).includes(hours)) {
    throw new ApiError(400, "Choose 48 hours, 7 days, 30 days, or keep until deleted.");
  }
  await prisma.user.update({ where: { id: userId }, data: { mediaKeepHours: hours } });
}
