import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { checkBeforeUpload, incrementAClass, addStorageEstimate, checkBeforeRead, incrementBClass } from "./r2-guardrail";
import sharp from "sharp";

let r2Client: S3Client | null = null;

export function getR2Client(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }

  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  return r2Client;
}

export function isR2Enabled(): boolean {
  return getR2Client() !== null && !!process.env.R2_BUCKET_NAME;
}

export interface UploadResult {
  url: string;
  fileId: string;
  thumbnailUrl?: string;
  name?: string;
}

/** Browser-ish headers; Instagram's CDN refuses plain server requests. */
const CDN_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: "https://www.instagram.com/",
  Accept: "*/*",
} as const;

/** Fetches a URL into a Buffer, or null if it can't be retrieved. */
export async function fetchToBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { headers: CDN_FETCH_HEADERS });
    if (!response.ok) {
      console.warn(`[R2] fetch failed (${response.status}): ${url.slice(0, 80)}`);
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.warn("[R2] fetch error:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Returns the public URL for an R2 object using the configured custom domain.
 * Requires R2_CUSTOM_DOMAIN in env. Do not use r2.dev domains.
 */
export function getR2ObjectUrl(key: string): string | null {
  const customDomain = process.env.R2_CUSTOM_DOMAIN?.trim();
  if (!customDomain) {
    console.warn("[R2] Missing R2_CUSTOM_DOMAIN env var");
    return null;
  }
  // Remove leading slashes from key and trailing slashes from domain
  const cleanKey = key.replace(/^\/+/, "");
  const cleanDomain = customDomain.replace(/\/+$/, "");
  return `https://${cleanDomain}/${cleanKey}`;
}

/** Uploads an in-memory buffer to R2. Used for both originals and thumbnails. */
export async function uploadBufferToR2(params: {
  buffer: Buffer;
  fileName: string;
  folder?: string;
  contentType?: string;
}): Promise<UploadResult | null> {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  if (!client || !bucket) return null;

  const { buffer, fileName, folder = "instascrapper", contentType = "application/octet-stream" } = params;
  
  // Format the key cleanly (e.g., "instascrapper/targets/username/media/file.jpg")
  const cleanFolder = folder.replace(/^\/+/, "").replace(/\/+$/, "");
  const key = cleanFolder ? `${cleanFolder}/${fileName}` : fileName;

  // 1. Guardrail Pre-flight Check
  const guardrailCheck = await checkBeforeUpload(buffer.length);
  if (!guardrailCheck.ok) {
    console.error(`[R2-Guardrail] Upload rejected: ${guardrailCheck.reason}`);
    return null;
  }

  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // Aggressive caching is required to save B-Class ops on reads
      CacheControl: "public, max-age=31536000, immutable",
    });

    await client.send(command);

    // 2. Guardrail Post-flight Counters
    await incrementAClass(1);
    await addStorageEstimate(buffer.length);

    const publicUrl = getR2ObjectUrl(key) || "";

    return { 
      url: publicUrl, 
      fileId: key, 
      name: fileName 
    };
  } catch (err) {
    console.error("[R2] Upload error:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Permanently removes a file from R2.
 */
export async function deleteR2Object(fileId: string): Promise<boolean> {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  if (!client || !bucket) return false;

  try {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: fileId,
    });
    
    // Delete ops are FREE in R2, no A-Class counter increment needed
    await client.send(command);
    return true;
  } catch (err) {
    console.error(`[R2] delete failed for ${fileId}:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Generates a presigned URL for downloading a file directly from R2 without caching.
 * Useful for the Re-Download feature when the user wants the raw file.
 */
export async function getPresignedDownloadUrl(fileId: string, expiresInSec = 3600): Promise<string | null> {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  if (!client || !bucket) return null;

  // Guardrail check for B-Class operations
  const check = await checkBeforeRead();
  if (!check.ok) {
    console.warn(`[R2-Guardrail] Presigned URL blocked: ${check.reason}`);
    return null;
  }

  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: fileId,
    });
    
    const signedUrl = await getSignedUrl(client, command, { expiresIn: expiresInSec });
    await incrementBClass(1); // Getting a presigned URL is practically a B-class op as it leads to a read
    
    return signedUrl;
  } catch (err) {
    console.error(`[R2] presign failed for ${fileId}:`, err);
    return null;
  }
}

/**
 * Builds a super-compressed thumbnail using Sharp and uploads it to R2.
 */
export async function createCompressedThumbnail(params: {
  sourceBuffer: Buffer;
  fileName: string;
  folder?: string;
  isVideo?: boolean;
}): Promise<UploadResult | null> {
  if (!isR2Enabled()) return null;

  const { sourceBuffer, fileName, folder, isVideo = false } = params;

  let thumbnailBuffer: Buffer;

  if (isVideo) {
    // For now, video thumbnail extraction via ffmpeg is skipped to avoid dependencies.
    // Use a static generic thumbnail buffer or 1x1 transparent pixel.
    // In a real implementation, you'd extract a frame here.
    thumbnailBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  } else {
    try {
      // Resize to 320w and compress heavily
      thumbnailBuffer = await sharp(sourceBuffer)
        .resize({ width: 320, withoutEnlargement: true })
        .jpeg({ quality: 40 })
        .toBuffer();
    } catch (err) {
      console.warn(`[R2] Sharp compression failed for ${fileName}`, err);
      return null;
    }
  }

  return uploadBufferToR2({ 
    buffer: thumbnailBuffer, 
    fileName, 
    folder,
    contentType: "image/jpeg"
  });
}
