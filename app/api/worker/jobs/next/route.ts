import { NextResponse } from "next/server";
import { jsonError, ApiError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { authenticateDevice } from "@/lib/meta/home-worker";

// Bounded well under Vercel's function limit so a call always returns cleanly
// even with nothing to do, and the worker just calls again.
const LONG_POLL_MS = 25_000;
const POLL_INTERVAL_MS = 800;

export const maxDuration = 30;

/** Worker-authenticated long poll: claims and returns the next job for this device, or {job: null}. */
export async function GET(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    const device = await authenticateDevice(token);
    if (!device) throw new ApiError(401, "Invalid or revoked device token.");

    const deadline = Date.now() + LONG_POLL_MS;
    while (Date.now() < deadline) {
      // Sweep this device's own expired jobs so a stale one is never handed out.
      await prisma.homeWorkerJob.updateMany({
        where: { deviceId: device.id, status: { in: ["PENDING", "CLAIMED"] }, expiresAt: { lt: new Date() } },
        data: { status: "EXPIRED" },
      });

      const candidate = await prisma.homeWorkerJob.findFirst({
        where: { deviceId: device.id, status: "PENDING", expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "asc" },
      });

      if (candidate) {
        const claimed = await prisma.homeWorkerJob.updateMany({
          where: { id: candidate.id, status: "PENDING" },
          data: { status: "CLAIMED", claimedAt: new Date() },
        });
        if (claimed.count === 1) {
          return NextResponse.json({
            job: { id: candidate.id, request: candidate.requestPayload },
          });
        }
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    return NextResponse.json({ job: null });
  } catch (err) {
    return jsonError(err);
  }
}
