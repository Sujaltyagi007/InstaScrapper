import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { EventType } from "@prisma/client";

const VALID_EVENT_TYPES = new Set<string>(Object.values(EventType));

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(req.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const take = Math.min(Number(url.searchParams.get("take") ?? 25), 100);
    const typeFilterRaw = url.searchParams.get("type") ?? undefined;
    const typeFilter = typeFilterRaw && VALID_EVENT_TYPES.has(typeFilterRaw) ? (typeFilterRaw as EventType) : undefined;

    const events = await prisma.event.findMany({
      where: { userId, ...(typeFilter ? { type: typeFilter } : {}) },
      include: { target: { select: { username: true, id: true } } },
      orderBy: { detectedAt: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = events.length > take;
    const page = hasMore ? events.slice(0, take) : events;

    return NextResponse.json({ events: page, nextCursor: hasMore ? page[page.length - 1].id : null });
  } catch (err) {
    return jsonError(err);
  }
}
