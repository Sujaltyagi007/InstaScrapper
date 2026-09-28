import { deleteR2Object, getPresignedDownloadUrl, isR2Enabled, uploadBufferToR2 } from "./r2";
import { contentHash, forgetStoredFile, recordStoredFile, type FileOwner } from "./ledger";
import { CDN_FETCH_HEADERS, fetchToBuffer, generateThumbnailBuffer, visualDistance, visualHash } from "./common";
import { appwriteDownloadUrl, appwriteFileInfo, appwriteFileUrl, deleteAppwriteFile, downloadAppwriteFile, isAppwriteEnabled, uploadBufferToAppwrite } from "./appwrite";

export { CDN_FETCH_HEADERS, fetchToBuffer, visualDistance, visualHash };
export type { FileOwner, StoredFileKind } from "./ledger";

export type StorageProvider = "appwrite" | "r2" | "none";

function r2Configured(): boolean {
  const id = process.env.R2_ACCOUNT_ID?.trim() ?? "";
  return isR2Enabled() && !id.startsWith("your_");
}

export function getStorageProvider(): StorageProvider {
  const wanted = process.env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (wanted === "appwrite") return isAppwriteEnabled() ? "appwrite" : "none";
  if (wanted === "r2") return r2Configured() ? "r2" : "none";
  if (isAppwriteEnabled()) return "appwrite";
  if (r2Configured()) return "r2";
  return "none";
}

export function isStorageEnabled(): boolean {
  return getStorageProvider() !== "none";
}

export interface StoredObject {
  url: string;
  fileId: string;
}

export async function uploadBuffer(params: {
  buffer: Buffer;
  fileName: string;
  folder: string;
  contentType: string;
  owner?: FileOwner;
}): Promise<StoredObject | null> {
  const folder = params.folder.replace(/^\/+|\/+$/g, "");
  const path = folder ? `${folder}/${params.fileName}` : params.fileName;

  let stored: StoredObject | null;
  switch (getStorageProvider()) {
    case "appwrite":
      stored = await uploadBufferToAppwrite({ buffer: params.buffer, fileName: path });
      break;
    case "r2": {
      const res = await uploadBufferToR2({
        buffer: params.buffer,
        fileName: params.fileName,
        folder,
        contentType: params.contentType,
      });
      stored = res && res.url ? { url: res.url, fileId: res.fileId } : null;
      break;
    }
    default:
      stored = null;
  }
  if (stored && params.owner) {
    await recordStoredFile({
      owner: params.owner,
      fileId: stored.fileId,
      url: stored.url,
      sizeBytes: params.buffer.length,
      contentType: params.contentType,
      hash: contentHash(params.buffer),
    });
  }
  return stored;
}


export async function deleteStoredObject(fileId: string): Promise<boolean> {
  let deleted: boolean;
  switch (getStorageProvider()) {
    case "appwrite":
      deleted = await deleteAppwriteFile(fileId);
      break;
    case "r2":
      deleted = await deleteR2Object(fileId);
      break;
    default:
      deleted = false;
  }
  if (deleted) await forgetStoredFile(fileId);
  return deleted;
}

/** Size, name and type of existing files; missing files are left out (Appwrite only, empty otherwise). */
export async function getStoredObjectInfo(fileIds: string[]) {
  return getStorageProvider() === "appwrite"
    ? appwriteFileInfo(fileIds)
    : new Map<string, { sizeBytes: number; name: string; mimeType: string; createdAt: string }>();
}

/** Reads a stored object's bytes with the provider's credentials (no public URL needed). */
export async function downloadStoredObject(fileId: string): Promise<Buffer | null> {
  switch (getStorageProvider()) {
    case "appwrite":
      return downloadAppwriteFile(fileId);
    case "r2": {
      const url = await getPresignedDownloadUrl(fileId, 300);
      return url ? fetchToBuffer(url) : null;
    }
    default:
      return null;
  }
}

/** Public link that downloads the file (null when the provider has no such link). */
export function publicDownloadUrl(fileId: string): string | null {
  return getStorageProvider() === "appwrite" ? appwriteDownloadUrl(fileId) : null;
}

/** Provider URL that triggers a browser download without proxying file bytes through a function. */
export async function storedObjectDownloadUrl(fileId: string, fileName: string): Promise<string | null> {
  switch (getStorageProvider()) {
    case "appwrite":
      return appwriteDownloadUrl(fileId);
    case "r2":
      return getPresignedDownloadUrl(fileId, 300, fileName);
    default:
      return null;
  }
}

/** Renders a compressed thumbnail locally (sharp) and stores it as its own file. */
export async function createCompressedThumbnail(params: {
  sourceBuffer: Buffer;
  fileName: string;
  folder: string;
  isVideo?: boolean;
  owner?: FileOwner;
}): Promise<StoredObject | null> {
  if (!isStorageEnabled()) return null;
  const thumb = await generateThumbnailBuffer(params.sourceBuffer, params.isVideo ?? false);
  if (!thumb) return null;
  return uploadBuffer({
    buffer: thumb,
    fileName: params.fileName,
    folder: params.folder,
    contentType: "image/jpeg",
    owner: params.owner ? { ...params.owner, kind: "THUMBNAIL" } : undefined,
  });
}

export { appwriteFileUrl };
