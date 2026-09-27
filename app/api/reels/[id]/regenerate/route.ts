import { after, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { advanceReelProjects, regenerateReelProject } from "@/lib/services/reel-pipeline.service";

export const maxDuration = 300;

const bodySchema = z.object({ from: z.enum(["SCRIPT", "VISUALS", "CAPTION"]) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose what to regenerate." }, { status: 400 });
    await regenerateReelProject(userId, id, parsed.data.from);
    after(() => advanceReelProjects({ projectId: id }).catch((err) => console.error("[reels] regenerate run failed:", err)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
