import { NextResponse } from "next/server";
import { jsonError, ApiError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { authenticateDevice } from "@/lib/meta/home-worker";

/** Worker-authenticated: posts the raw response (or an error) for a claimed job. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    const device = await authenticateDevice(token);
    if (!device) throw new ApiError(401, "Invalid or revoked device token.");

    const { id } = await params;
    const body = await req.json();

    if (body.error) {
      await prisma.homeWorkerJob.updateMany({
        where: { id, deviceId: device.id, status: "CLAIMED" },
        data: { status: "FAILED", responsePayload: { error: String(body.error).slice(0, 2000) } },
      });
      return NextResponse.json({ ok: true });
    }

    const status = Number(body.status);
    const text = typeof body.text === "string" ? body.text : "";
    if (!Number.isFinite(status)) throw new ApiError(400, "status must be a number.");

    const updated = await prisma.homeWorkerJob.updateMany({
      where: { id, deviceId: device.id, status: "CLAIMED" },
      data: { status: "DONE", responsePayload: { status, text } },
    });
    if (updated.count === 0) {
      // Already expired/claimed by nothing — not an error the worker should retry.
      return NextResponse.json({ ok: false, reason: "Job was no longer claimable (likely expired)." });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
