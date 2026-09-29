import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { saveManualMediaMetrics } from "@/lib/services/media-metrics.service";

const bodySchema = z.object({
  mediaId: z.string().min(1).max(191),
  playCount: z.number().int().min(0).max(2_147_483_647).nullable(),
  likeCount: z.number().int().min(0).max(2_147_483_647),
  commentCount: z.number().int().min(0).max(2_147_483_647),
  postedAt: z.string().date(),
});

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid metrics." }, { status: 400 });
    }
    if (parsed.data.postedAt > new Date().toISOString().slice(0, 10)) {
      return NextResponse.json({ error: "Post date cannot be in the future." }, { status: 400 });
    }

    await saveManualMediaMetrics(userId, parsed.data.mediaId, {
      playCount: parsed.data.playCount,
      likeCount: parsed.data.likeCount,
      commentCount: parsed.data.commentCount,
      postedAt: new Date(`${parsed.data.postedAt}T00:00:00.000Z`),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}