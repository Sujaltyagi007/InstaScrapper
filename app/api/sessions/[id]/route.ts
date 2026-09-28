import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUserId();
    const { id } = await params;

    await prisma.instagramSession.deleteMany({
      where: { id, userId },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const body = await req.json();

    if (body.resetFlag) {
      await prisma.instagramSession.updateMany({
        where: { id, userId },
        data: { status: "ACTIVE", cooldownUntil: null, lastErrorMessage: null },
      });
    } else if (body.status === "ACTIVE" || body.status === "PAUSED") {
      await prisma.instagramSession.updateMany({
        where: { id, userId },
        data: { status: body.status },
      });
    } else if (body.transport === "PROXY") {
      await prisma.instagramSession.updateMany({
        where: { id, userId },
        data: { transport: "PROXY", homeWorkerDeviceId: null },
      });
    } else if (body.transport === "HOME_WORKER") {
      const deviceId = typeof body.homeWorkerDeviceId === "string" ? body.homeWorkerDeviceId : null;
      if (!deviceId) return NextResponse.json({ error: "Pick a paired device first." }, { status: 400 });

      const device = await prisma.homeWorkerDevice.findFirst({ where: { id: deviceId, userId, status: "ACTIVE" } });
      if (!device) return NextResponse.json({ error: "That device isn't paired or was revoked." }, { status: 400 });

      // One device per burner (see proxy-identity.ts's "one fixed IP per
      // burner" rule) — a device already pinned to another session would
      // share one home IP across two accounts, which is itself a flag.
      const alreadyUsed = await prisma.instagramSession.findFirst({
        where: { homeWorkerDeviceId: deviceId, id: { not: id } },
        select: { username: true },
      });
      if (alreadyUsed) {
        return NextResponse.json(
          { error: `That device is already paired to @${alreadyUsed.username}. Pair a separate device per burner.` },
          { status: 400 },
        );
      }

      await prisma.instagramSession.updateMany({
        where: { id, userId },
        data: { transport: "HOME_WORKER", homeWorkerDeviceId: deviceId },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
