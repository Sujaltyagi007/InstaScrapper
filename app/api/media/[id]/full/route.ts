import { NextResponse } from "next/server";
import { requireUserId, jsonError, ApiError } from "@/lib/api-helpers";
import { loadFullMedia } from "@/lib/services/media-storage.service";

// One logged-in lookup plus uploading a video or every carousel item.
export const maxDuration = 120;

/**
 * Loads a post's real video file or every carousel item with one logged-in
 * request, for posts saved by a logged-out check.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const result = await loadFullMedia(userId, id);
    if (result.ok) return NextResponse.json({ ok: true, media: result.media });

    switch (result.reason) {
      case "not_found":
        throw new ApiError(404, "Media not found.");
      case "not_needed":
        throw new ApiError(422, "This post is a single photo, so there is nothing more to load.");
      case "no_burner":
        throw new ApiError(
          409,
          result.availableAt
            ? "Your Instagram session is resting after a warning or has used today's limit. The post still plays above; save it once the session is back."
            : "No active Instagram session. Add or resume one in Settings to save videos.",
          "NO_SESSION_AVAILABLE",
          result.availableAt ? { availableAt: result.availableAt.toISOString() } : undefined,
        );
      case "rate_limited":
        throw new ApiError(429, "Instagram asked this account to slow down, so it is paused for a few hours to stay safe.", "SESSION_PAUSED");
      case "flagged":
        throw new ApiError(409, "Instagram wants this account verified. Open Instagram in your browser, clear it, then add the session again.", "SESSION_FLAGGED");
      case "storage":
        throw new ApiError(502, "The files could not be saved to storage. Try again.");
      default:
        throw new ApiError(502, "Instagram did not return this post. It may have been deleted.");
    }
  } catch (err) {
    return jsonError(err);
  }
}
