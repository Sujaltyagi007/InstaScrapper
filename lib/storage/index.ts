/**
 * Storage facade — the ONLY module app code should import for file storage.
 *
 * Picks a provider from STORAGE_PROVIDER ("appwrite" | "r2"). When unset it
 * uses whichever provider is actually configured, preferring Appwrite. To
 * switch clouds, change the env var; no caller changes.
 */
import { appwriteFileUrl, deleteAppwriteFile, isAppwriteEnabled, uploadBufferToAppwrite } from "./appwrite";
import { deleteR2Object, isR2Enabled, uploadBufferToR2 } from "./r2";
import { fetchToBuffer, generateThumbnailBuffer } from "./common";

export { fetchToBuffer };

export type StorageProvider = "appwrite" | "r2" | "none";

function r2Configured(): boolean {
  // isR2Enabled() only checks that vars exist; placeholder values would make
  // every upload fail at runtime, so treat them as unconfigured.
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
}): Promise<StoredObject | null> {
  const folder = params.folder.replace(/^\/+|\/+$/g, "");
  const path = folder ? `${folder}/${params.fileName}` : params.fileName;

  switch (getStorageProvider()) {
    case "appwrite":
      return uploadBufferToAppwrite({ buffer: params.buffer, fileName: path });
    case "r2": {
      const res = await uploadBufferToR2({
        buffer: params.buffer,
        fileName: params.fileName,
        folder,
        contentType: params.contentType,
      });
      return res && res.url ? { url: res.url, fileId: res.fileId } : null;
    }
    default:
      return null;
  }
}

/**
 * Deletes a stored object. File IDs are provider-specific, so this only works
 * for objects created by the currently active provider — see brain.md about
 * switching providers with media already stored.
 */
export async function deleteStoredObject(fileId: string): Promise<boolean> {
  switch (getStorageProvider()) {
    case "appwrite":
      return deleteAppwriteFile(fileId);
    case "r2":
      return deleteR2Object(fileId);
    default:
      return false;
  }
}

/** Renders a compressed thumbnail locally (sharp) and stores it as its own file. */
export async function createCompressedThumbnail(params: {
  sourceBuffer: Buffer;
  fileName: string;
  folder: string;
  isVideo?: boolean;
}): Promise<StoredObject | null> {
  if (!isStorageEnabled()) return null;
  const thumb = await generateThumbnailBuffer(params.sourceBuffer, params.isVideo ?? false);
  if (!thumb) return null;
  return uploadBuffer({ buffer: thumb, fileName: params.fileName, folder: params.folder, contentType: "image/jpeg" });
}

export { appwriteFileUrl };
