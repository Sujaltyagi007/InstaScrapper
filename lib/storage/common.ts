import sharp from "sharp";

/**
 * Provider-neutral storage helpers. Nothing in here knows which cloud the
 * bytes end up in, so switching providers never touches this file.
 */

/** Browser-ish headers; Instagram's CDN refuses plain server requests. */
export const CDN_FETCH_HEADERS = {
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
      console.warn(`[storage] fetch failed (${response.status}): ${url.slice(0, 80)}`);
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.warn("[storage] fetch error:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Renders a super-compressed JPEG thumbnail (320px wide, quality 40) locally.
 *
 * Returns null for video: sharp can't decode video frames, and storing a
 * fake 1x1 image (what the R2 version did) produces a blank tile that looks
 * like a broken upload. With no thumbnail the UI falls back cleanly.
 */
export async function generateThumbnailBuffer(
  source: Buffer,
  isVideo: boolean
): Promise<Buffer | null> {
  if (isVideo) return null;
  try {
    return await sharp(source)
      .resize({ width: 320, withoutEnlargement: true })
      .jpeg({ quality: 40, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    console.warn("[storage] thumbnail render failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Perceptual "average hash" of an image: 16x16 grayscale, one bit per pixel
 * (above/below the mean), as 64 hex chars. The same picture at a different
 * size or compression lands within a few bits; a different picture doesn't.
 * Null when the bytes aren't a decodable image.
 */
export async function visualHash(buffer: Buffer): Promise<string | null> {
  try {
    const px = await sharp(buffer)
      .flatten({ background: "#ffffff" })
      .grayscale()
      .resize(16, 16, { fit: "fill" })
      .raw()
      .toBuffer();
    if (px.length !== 256) return null;
    const mean = px.reduce((sum, v) => sum + v, 0) / px.length;
    let hex = "";
    for (let i = 0; i < px.length; i += 4) {
      let nibble = 0;
      for (let j = 0; j < 4; j++) nibble = (nibble << 1) | (px[i + j] >= mean ? 1 : 0);
      hex += nibble.toString(16);
    }
    return hex;
  } catch {
    return null;
  }
}

/** Number of differing bits between two visualHash values (256 = nothing alike). */
export function visualDistance(a: string, b: string): number {
  if (a.length !== b.length) return 256;
  let bits = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      bits += x & 1;
      x >>= 1;
    }
  }
  return bits;
}
