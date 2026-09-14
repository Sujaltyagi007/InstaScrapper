import { NextResponse } from "next/server";
import { requireUserId, jsonError, ApiError } from "@/lib/api-helpers";
import { updateMonitorSchema } from "@/lib/validation/target";
import { getTargetDetail, updateTargetMonitor, deleteTarget } from "@/lib/services/target.service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const target = await getTargetDetail(userId, id);
    if (!target) throw new ApiError(404, "Target not found.");
    return NextResponse.json({ target });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const body = await req.json();
    const parsed = updateMonitorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
    }
    const monitor = await updateTargetMonitor(userId, id, parsed.data);
    return NextResponse.json({ monitor });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    await deleteTarget(userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
