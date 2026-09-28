import { InputFile } from "node-appwrite/file";
import { Client, ID, Permission, Query, Role, Storage } from "node-appwrite";


export interface StoredObject {
  url: string;
  fileId: string;
}

function config() {
  const endpoint = process.env.APPWRITE_ENDPOINT?.trim().replace(/\/+$/, "");
  const projectId = process.env.APPWRITE_PROJECT_ID?.trim();
  const apiKey = process.env.APPWRITE_API_KEY?.trim();
  const bucketId = process.env.APPWRITE_BUCKET_ID?.trim();
  if (!endpoint || !projectId || !apiKey || !bucketId) return null;
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

export async function uploadBufferToAppwrite(params: { buffer: Buffer; fileName: string; }): Promise<StoredObject | null> {
  const ctx = getStorage();
  if (!ctx) return null;

  try {
    const file = await ctx.storage.createFile({
      bucketId: ctx.cfg.bucketId,
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

export async function downloadAppwriteFile(fileId: string): Promise<Buffer | null> {
  const ctx = getStorage();
  if (!ctx) return null;

  try {
    const bytes = await ctx.storage.getFileDownload({ bucketId: ctx.cfg.bucketId, fileId });
    return Buffer.from(bytes);
  } catch (err) {
    console.error(`[appwrite] download failed for ${fileId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Like appwriteFileUrl, but served as an attachment so phones save it instead of playing it. */
export function appwriteDownloadUrl(fileId: string): string | null {
  const cfg = config();
  if (!cfg) return null;
  return `${cfg.endpoint}/storage/buckets/${cfg.bucketId}/files/${encodeURIComponent(fileId)}/download?project=${cfg.projectId}`;
}

/**
 * Sizes and names for existing files (up to 100 ids per request). Files that
 * no longer exist are simply absent from the result.
 */
export async function appwriteFileInfo(
  fileIds: string[],
): Promise<Map<string, { sizeBytes: number; name: string; mimeType: string; createdAt: string }>> {
  const info = new Map<string, { sizeBytes: number; name: string; mimeType: string; createdAt: string }>();
  const ctx = getStorage();
  if (!ctx || fileIds.length === 0) return info;
  for (let i = 0; i < fileIds.length; i += 100) {
    const batch = fileIds.slice(i, i + 100);
    const list = await ctx.storage.listFiles({
      bucketId: ctx.cfg.bucketId,
      queries: [Query.equal("$id", batch), Query.limit(100)],
    });
    for (const f of list.files) {
      info.set(f.$id, { sizeBytes: f.sizeOriginal, name: f.name, mimeType: f.mimeType, createdAt: f.$createdAt });
    }
  }
  return info;
}
