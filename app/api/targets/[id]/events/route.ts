import { NextResponse } from "next/server";
import { requireUserId, jsonError, ApiError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const target = await prisma.target.findFirst({ where: { id, userId }, select: { id: true } });
    if (!target) throw new ApiError(404, "Target not found.");

    const url = new URL(req.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const take = Math.min(Number(url.searchParams.get("take") ?? 20), 100);

    const events = await prisma.event.findMany({
      where: { targetId: id },
      orderBy: { detectedAt: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = events.length > take;
    const page = hasMore ? events.slice(0, take) : events;

    return NextResponse.json({
      events: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  } catch (err) {
    return jsonError(err);
  }
}
