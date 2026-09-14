import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";

export async function GET() {
  try {
    const userId = await requireUserId();
    const jobs = await prisma.job.findMany({
      where: { OR: [{ target: { userId } }, { targetId: null }] },
      include: { target: { select: { username: true } } },
      orderBy: { runAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ jobs });
  } catch (err) {
    return jsonError(err);
  }
}
