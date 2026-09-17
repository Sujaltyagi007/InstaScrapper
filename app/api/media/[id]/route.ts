import { NextResponse } from "next/server";
import { requireUserId, jsonError, ApiError } from "@/lib/api-helpers";
import { permanentlyDeleteMedia } from "@/lib/services/media-storage.service";

/**
 * Permanent delete: wipes the heavy file, the compressed thumbnail, and the
 * database row. One of the two actions offered on an expired item.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;

    const result = await permanentlyDeleteMedia(userId, id);
    if (!result.ok) throw new ApiError(404, "Media not found.");

    return NextResponse.json({
      ok: true,
      // Surfaced rather than swallowed: the row is gone, but these storage
      // files could not be removed and may need manual reconciliation.
      storageFailures: result.storageFailures,
    });
  } catch (err) {
    return jsonError(err);
  }
}
