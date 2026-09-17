import { NextResponse } from "next/server";
import { requireUserId, jsonError, ApiError } from "@/lib/api-helpers";
import { redownloadMedia } from "@/lib/services/media-storage.service";

// Re-scraping the post page plus re-uploading the file can take a while.
export const maxDuration = 120;

/**
 * On-demand re-download for an expired item. Fetches the full media from the
 * original source again and re-stores it, which restarts the 48-hour clock so
 * the re-downloaded file is subject to the same policy.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;

    const result = await redownloadMedia(userId, id);

    if (!result.ok) {
      if (result.reason === "not_found") throw new ApiError(404, "Media not found.");
      if (result.reason === "no_source") {
        throw new ApiError(
          422,
          "No source link stored for this item, so it can't be re-downloaded."
        );
      }
      // The post was most likely deleted upstream, or Instagram refused every
      // attempt. Either way the user's only remaining option is to delete it.
      throw new ApiError(
        502,
        "Couldn't re-fetch this media from Instagram. The post may have been deleted."
      );
    }

    return NextResponse.json({
      ok: true,
      media: result.media,
      isVideo: result.usedVideo,
    });
  } catch (err) {
    return jsonError(err);
  }
}
