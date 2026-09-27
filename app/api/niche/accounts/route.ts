import { NextResponse } from "next/server";
import { ApiError, jsonError, requireUserId } from "@/lib/api-helpers";
import { addNicheAccountSchema } from "@/lib/validation/niche";
import { addNicheAccount, removeNicheAccount } from "@/lib/services/niche.service";

// Adding resolves the account on Instagram first, which can take ~30s when
// Instagram keeps serving its login page.
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = addNicheAccountSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
    }
    const account = await addNicheAccount(userId, parsed.data.username, parsed.data.source);
    return NextResponse.json({ account }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new ApiError(400, "Niche account id is required.");
    await removeNicheAccount(userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
