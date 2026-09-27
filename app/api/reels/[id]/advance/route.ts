import { after, NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { advanceReelProjects, isReelProjectKickable } from "@/lib/services/reel-pipeline.service";

// The stage runs after the response, inside this function's time (render needs most of it).
export const maxDuration = 300;

// Called by the open Studio page when a reel is due but nothing is working on it,
// so reels keep moving even before the external scheduler is set up.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const started = await isReelProjectKickable(userId, id);
    if (started) {
      after(() => advanceReelProjects({ projectId: id }).catch((err) => console.error("[reels] kick failed:", err)));
    }
    return NextResponse.json({ started });
  } catch (err) {
    return jsonError(err);
  }
}
