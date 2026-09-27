import { after, NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { advanceReelProjects, retryReelProject } from "@/lib/services/reel-pipeline.service";

// The retried stage runs right after the response, inside this function's time.
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    await retryReelProject(userId, id);
    after(() => advanceReelProjects({ projectId: id }).catch((err) => console.error("[reels] retry run failed:", err)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
