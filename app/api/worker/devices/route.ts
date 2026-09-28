import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { pairDevice } from "@/lib/meta/home-worker";

export async function GET() {
  try {
    const userId = await requireUserId();
    const devices = await prisma.homeWorkerDevice.findMany({
      where: { userId },
      select: { id: true, label: true, status: true, lastSeenAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ devices });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = await req.json().catch(() => ({}));
    const label = typeof body.label === "string" ? body.label : "Home worker";
    // The token is returned once, here, and never again — only its hash is stored.
    const { id, token } = await pairDevice(userId, label);
    return NextResponse.json({ id, token }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
