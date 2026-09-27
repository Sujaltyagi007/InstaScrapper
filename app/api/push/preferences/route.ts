import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { pushPreferencesSchema } from "@/lib/validation/push";
import { updatePushPreferences } from "@/lib/services/push.service";

/** `{ enabled?, eventTypes? }` — eventTypes: [] means every event type. */
export async function PATCH(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = pushPreferencesSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid preferences." }, { status: 400 });
    }
    return NextResponse.json(await updatePushPreferences(userId, parsed.data));
  } catch (err) {
    return jsonError(err);
  }
}
