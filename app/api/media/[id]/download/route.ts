import { NextResponse } from "next/server";
import { ApiError, jsonError, requireUserId } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { storedObjectDownloadUrl } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const media = await prisma.media.findFirst({
      where: { id, target: { userId } },
      select: { storageFileId: true, externalMediaId: true, mediaType: true, target: { select: { normalizedUsername: true } } },
    });
    if (!media?.storageFileId) throw new ApiError(404, "Saved media not found.");

    const isVideo = media.mediaType === "VIDEO" || media.mediaType === "REEL";
    const fileName = `${media.target.normalizedUsername}-${media.externalMediaId}.${isVideo ? "mp4" : "jpg"}`;
    const url = await storedObjectDownloadUrl(media.storageFileId, fileName);
    if (!url) throw new ApiError(502, "The media download is unavailable.");

    return NextResponse.redirect(url, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return jsonError(err);
  }
}