import ImageKit from "imagekit";

let imageKitClient: ImageKit | null = null;

export function getImageKitClient(): ImageKit | null {
  const publicKey = process.env.IMAGEKIT_PUBLIC_KEY?.trim();
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY?.trim();
  const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT?.trim();

  if (!publicKey || !privateKey || !urlEndpoint) {
    return null;
  }

  if (!imageKitClient) {
    imageKitClient = new ImageKit({
      publicKey,
      privateKey,
      urlEndpoint,
    });
  }

  return imageKitClient;
}

export function isImageKitEnabled(): boolean {
  return getImageKitClient() !== null;
}

export interface UploadResult {
  url: string;
  fileId: string;
  thumbnailUrl?: string;
  name?: string;
}

/**
 * Downloads media from upstream Instagram CDN buffer with proper browser headers,
 * then uploads directly to ImageKit.io.
 * This guarantees Instagram anti-hotlinking headers do not block ImageKit from ingesting the file.
 */
export async function uploadRemoteMediaToImageKit(params: {
  url: string;
  fileName: string;
  folder?: string;
  tags?: string[];
}): Promise<UploadResult | null> {
  const client = getImageKitClient();
  if (!client) {
    return null;
  }

  const { url, fileName, folder = process.env.IMAGEKIT_FOLDER || "/instascrapper", tags = [] } = params;

  try {
    // 1. Fetch binary buffer from Instagram CDN with browser User-Agent
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://www.instagram.com/",
        Accept: "*/*",
      },
    });

    if (!response.ok) {
      console.warn(`[ImageKit] Failed to download media from Instagram (${response.status}): ${url.slice(0, 80)}...`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2. Upload buffer to ImageKit
    const res = await client.upload({
      file: buffer,
      fileName,
      folder,
      tags,
      useUniqueFileName: false,
    });

    return {
      url: res.url,
      fileId: res.fileId,
      thumbnailUrl: res.thumbnailUrl,
      name: res.name,
    };
  } catch (err) {
    console.error("[ImageKit] Upload error:", err instanceof Error ? err.message : err);
    return null;
  }
}
