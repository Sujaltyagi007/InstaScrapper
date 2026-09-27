import { NextResponse } from "next/server";
import { requireUserId, jsonError, ApiError } from "@/lib/api-helpers";
import { updateMonitorSchema } from "@/lib/validation/target";
import { getTargetDetail, updateTargetMonitor, deleteTarget } from "@/lib/services/target.service";

// Deleting an account with many stored files can take a while.
export const maxDuration = 120;

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

// ?deleteFiles=1 also deletes the account's stored media (see deleteTarget).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const deleteFiles = new URL(req.url).searchParams.get("deleteFiles") === "1";
    await deleteTarget(userId, id, { deleteFiles });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
