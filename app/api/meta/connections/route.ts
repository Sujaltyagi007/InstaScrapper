import { NextResponse } from "next/server";
import { requireUserId, jsonError, ApiError } from "@/lib/api-helpers";
import { listMetaConnections, disconnectMeta } from "@/lib/services/meta-connection.service";

export async function GET() {
  try {
    const userId = await requireUserId();
    const connections = await listMetaConnections(userId);
    return NextResponse.json({ connections });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new ApiError(400, "Connection id is required.");
    await disconnectMeta(userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
