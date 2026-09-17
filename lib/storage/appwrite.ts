import { Client, ID, Permission, Role, Storage } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

/**
 * Appwrite Storage adapter.
 *
 * Why Appwrite: its Cloud free plan doesn't take a payment method, so the
 * worst case is hitting a limit (uploads start failing), not a surprise bill.
 * That's a hard cap by construction, which R2 doesn't offer.
 *
 * Bucket setup (Appwrite console → Storage → your bucket):
 *   - Permissions: add Role "Any" with READ, so media URLs render in <img>.
 *   - File security: leave OFF (bucket-level permissions are enough).
 *   - API key scopes: files.read + files.write.
 */

export interface StoredObject {
  url: string;
  /** Appwrite file ID — what we persist as storageFileId / thumbnailFileId. */
  fileId: string;
}

function config() {
  const endpoint = process.env.APPWRITE_ENDPOINT?.trim().replace(/\/+$/, "");
  const projectId = process.env.APPWRITE_PROJECT_ID?.trim();
  const apiKey = process.env.APPWRITE_API_KEY?.trim();
  const bucketId = process.env.APPWRITE_BUCKET_ID?.trim();
  if (!endpoint || !projectId || !apiKey || !bucketId) return null;
  // Reject the template placeholders, so a half-filled .env reads as
  // "disabled" instead of failing every upload at runtime.
  if ([projectId, apiKey, bucketId].some((v) => v.startsWith("your_"))) return null;
  return { endpoint, projectId, apiKey, bucketId };
}

let storageClient: Storage | null = null;

function getStorage(): { storage: Storage; cfg: NonNullable<ReturnType<typeof config>> } | null {
  const cfg = config();
  if (!cfg) return null;
  if (!storageClient) {
    const client = new Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId).setKey(cfg.apiKey);
    storageClient = new Storage(client);
  }
  return { storage: storageClient, cfg };
}

export function isAppwriteEnabled(): boolean {
  return config() !== null;
}

/** Public URL that serves the file's bytes (requires Role "Any" read on the bucket). */
export function appwriteFileUrl(fileId: string): string | null {
  const cfg = config();
  if (!cfg) return null;
  return `${cfg.endpoint}/storage/buckets/${cfg.bucketId}/files/${encodeURIComponent(fileId)}/view?project=${cfg.projectId}`;
}

export async function uploadBufferToAppwrite(params: {
  buffer: Buffer;
  /** Human-readable name incl. path, e.g. "targets/nasa/media/nasa_123.jpg". */
  fileName: string;
}): Promise<StoredObject | null> {
  const ctx = getStorage();
  if (!ctx) return null;

  try {
    const file = await ctx.storage.createFile({
      bucketId: ctx.cfg.bucketId,
      // Appwrite IDs are capped at 36 chars from a restricted charset, so a
      // generated ID is used and the readable path lives in the file name.
      fileId: ID.unique(),
      file: InputFile.fromBuffer(new Uint8Array(params.buffer), params.fileName),
      permissions: [Permission.read(Role.any())],
    });
    const url = appwriteFileUrl(file.$id);
    return url ? { url, fileId: file.$id } : null;
  } catch (err) {
    console.error("[appwrite] upload failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Deletes a file. "File not found" counts as success: the goal is "this file
 * must not exist", and failing would make the expiry sweep retry forever.
 *
 * Only that exact error type, though. Appwrite also returns 404 for
 * `project_not_found` and `storage_bucket_not_found` (verified against the
 * live API). Treating those as success would let a mistyped project or bucket
 * ID mark every item expired while its files stay in storage.
 */
export async function deleteAppwriteFile(fileId: string): Promise<boolean> {
  const ctx = getStorage();
  if (!ctx) return false;

  try {
    await ctx.storage.deleteFile({ bucketId: ctx.cfg.bucketId, fileId });
    return true;
  } catch (err) {
    const type = (err as { type?: string })?.type;
    if (type === "storage_file_not_found") return true;
    console.error(`[appwrite] delete failed for ${fileId}:`, err instanceof Error ? err.message : err);
    return false;
  }
}
