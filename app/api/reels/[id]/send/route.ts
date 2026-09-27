import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { cancelReelSend, scheduleReelSend, sendReelNow } from "@/lib/services/reel-delivery.service";

const bodySchema = z.object({ mode: z.enum(["now", "best"]) });

// Send to phone: now, or at the next good posting time.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose now or best time." }, { status: 400 });
    if (parsed.data.mode === "now") {
      await sendReelNow(userId, id);
      return NextResponse.json({ sent: true });
    }
    return NextResponse.json({ scheduledFor: await scheduleReelSend(userId, id) });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    await cancelReelSend(userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
