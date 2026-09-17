/**
 * Shared media download used by both the dashboard gallery and the mobile
 * simulator. Kept in one place so the two views can't drift apart.
 */

/** Maps a blob MIME type to a file extension. */
function extensionFromMime(mime: string): string | null {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  return map[mime.split(";")[0].trim().toLowerCase()] ?? null;
}

/** Last-resort guess from the URL path, ignoring query strings. */
function extensionFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url, "https://example.invalid").pathname;
    const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function downloadMedia(
  url: string,
  mediaType: string,
  externalId: string,
  username: string
) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch media (HTTP ${response.status})`);
    const blob = await response.blob();

    // Derive the extension from what we actually downloaded, NOT from
    // mediaType. An anonymously-scraped REEL has no video URL — the stored
    // asset is a JPG thumbnail — so trusting mediaType would save a JPEG
    // named ".mp4" and produce a file that won't open.
    const ext =
      extensionFromMime(blob.type) ??
      extensionFromUrl(url) ??
      (mediaType === "VIDEO" || mediaType === "REEL" ? "mp4" : "jpg");

    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${username}-${externalId}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
    return { ok: true as const };
  } catch (error) {
    // Cross-origin assets (e.g. Instagram's CDN) block fetch(), so fall back
    // to opening the asset in a new tab where the browser can save it.
    console.error("Download failed, opening in new tab instead:", error);
    window.open(url, "_blank", "noopener,noreferrer");
    return { ok: false as const, error };
  }
}

/**
 * True when a media row's only stored asset is a still image, even though it
 * represents a video/reel. Used to label the UI honestly instead of offering
 * a "video" the user can't actually get.
 */
export function isThumbnailOnlyVideo(item: {
  mediaType: string;
  videoUrl: string | null;
}): boolean {
  const isVideoKind = item.mediaType === "VIDEO" || item.mediaType === "REEL";
  return isVideoKind && !item.videoUrl;
}
