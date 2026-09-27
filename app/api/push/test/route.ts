import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { pushTestSchema } from "@/lib/validation/push";
import { sendPushTest } from "@/lib/services/push.service";

/** Test push to `endpoint` (this device) or, without it, to every device. */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = pushTestSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    return NextResponse.json(await sendPushTest(userId, parsed.data.endpoint));
  } catch (err) {
    return jsonError(err);
  }
}
