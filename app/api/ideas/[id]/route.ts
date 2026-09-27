import { after, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { setIdeaStatus } from "@/lib/services/idea.service";
import { advanceReelProjects, createProjectForIdea } from "@/lib/services/reel-pipeline.service";

// Approving starts the reel's first stages right after the response.
export const maxDuration = 300;

const bodySchema = z.object({ status: z.enum(["SUGGESTED", "APPROVED", "DISMISSED"]) });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    await setIdeaStatus(userId, id, parsed.data.status);

    if (parsed.data.status !== "APPROVED") return NextResponse.json({ ok: true });
    const project = await createProjectForIdea(userId, id);
    after(() =>
      advanceReelProjects({ projectId: project.id }).catch((err) => console.error("[reels] first run failed:", err)),
    );
    return NextResponse.json({ ok: true, projectId: project.id });
  } catch (err) {
    return jsonError(err);
  }
}
