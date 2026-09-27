/**
 * The file register: one StoredFile row per object this app put in storage,
 * owned by a user. The storage facade records uploads and forgets deletions
 * here, so the Storage page can list and delete a user's files even after the
 * target they came from is gone.
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export type StoredFileKind = "MEDIA" | "THUMBNAIL" | "STORY" | "PROFILE_PIC" | "REEL" | "SOUND" | "OTHER";

export interface FileOwner {
  userId: string;
  kind: StoredFileKind;
  label?: string;
  targetId?: string | null;
  targetUsername?: string | null;
  /** Perceptual hash for images that should be de-duplicated visually (profile pictures). */
  visualHash?: string | null;
}

export function contentHash(buffer: Buffer): string {
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

/** Never fails the upload it describes: a missing row is repaired by the next sync. */
export async function recordStoredFile(params: {
  owner: FileOwner;
  fileId: string;
  url: string;
  sizeBytes: number;
  contentType: string;
  hash: string;
}): Promise<void> {
  try {
    await prisma.storedFile.create({
      data: {
        userId: params.owner.userId,
        fileId: params.fileId,
        url: params.url,
        kind: params.owner.kind,
        label: params.owner.label?.slice(0, 200) ?? null,
        targetId: params.owner.targetId ?? null,
        targetUsername: params.owner.targetUsername ?? null,
        contentType: params.contentType,
        sizeBytes: params.sizeBytes,
        contentHash: params.hash,
        visualHash: params.owner.visualHash ?? null,
      },
    });
  } catch (err) {
    console.warn("[storage-ledger] couldn't record file:", err instanceof Error ? err.message : err);
  }
}

export async function forgetStoredFile(fileId: string): Promise<void> {
  await prisma.storedFile.deleteMany({ where: { fileId } }).catch(() => {});
}
