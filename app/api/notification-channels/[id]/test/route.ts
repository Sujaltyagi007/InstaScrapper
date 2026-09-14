import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { sendTestNotification } from "@/lib/services/notification.service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    await sendTestNotification(id, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
