import { NextResponse } from "next/server";
import { jsonError, requireUserId, ApiError } from "@/lib/api-helpers";
import { deleteUserKey, recheckUserKey } from "@/lib/ai/keys";
import { keyActionSchema } from "@/lib/validation/ai-keys";

/** "Check again": re-tests a saved key with its provider. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    if (!keyActionSchema.safeParse(await req.json().catch(() => null)).success) throw new ApiError(400, "Unknown action.");
    return NextResponse.json(await recheckUserKey(userId, id));
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    await deleteUserKey(userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
