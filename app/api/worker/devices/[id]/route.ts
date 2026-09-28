import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

/**
 * Revokes a device. Sessions pinned to it fall back to PROXY so a revoked
 * device can't strand a burner in HOME_WORKER with nothing able to claim its jobs.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    await prisma.$transaction([
      prisma.instagramSession.updateMany({
        where: { userId, homeWorkerDeviceId: id },
        data: { transport: "PROXY", homeWorkerDeviceId: null },
      }),
      prisma.homeWorkerDevice.updateMany({ where: { id, userId }, data: { status: "REVOKED" } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
