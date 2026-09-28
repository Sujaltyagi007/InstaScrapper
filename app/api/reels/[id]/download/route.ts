import { NextResponse } from "next/server";
import { ApiError, jsonError, requireUserId } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { storedObjectDownloadUrl } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const project = await prisma.reelProject.findFirst({
      where: { id, userId },
      select: { renderFileId: true },
    });
    if (!project?.renderFileId) throw new ApiError(404, "Reel video not found.");

    const url = await storedObjectDownloadUrl(project.renderFileId, `reel-${id}.mp4`);
    if (!url) throw new ApiError(502, "The reel download is unavailable.");

    return NextResponse.redirect(url, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return jsonError(err);
  }
}