import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { markReelPosted } from "@/lib/services/reel-pipeline.service";

const bodySchema = z.object({ url: z.string().url().max(500).optional().or(z.literal("")) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "That link doesn't look right." }, { status: 400 });
    await markReelPosted(userId, id, parsed.data.url || undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
