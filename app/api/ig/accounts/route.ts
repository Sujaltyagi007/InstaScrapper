import { NextResponse } from "next/server";
import { ApiError, jsonError, requireUserId } from "@/lib/api-helpers";
import { disconnectIgAccount, isIgLoginConfigured, listIgAccounts } from "@/lib/services/ig-account.service";

export async function GET() {
  try {
    const userId = await requireUserId();
    const accounts = await listIgAccounts(userId);
    return NextResponse.json({ configured: isIgLoginConfigured(), accounts });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new ApiError(400, "Account id is required.");
    await disconnectIgAccount(userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
