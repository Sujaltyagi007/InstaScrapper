import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { listEventsPage } from "@/lib/services/event.service";
import { EventType } from "@prisma/client";

const VALID_EVENT_TYPES = new Set<string>(Object.values(EventType));

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(req.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const take = Number(url.searchParams.get("take") ?? 25);
    const typeFilterRaw = url.searchParams.get("type") ?? undefined;
    const type = typeFilterRaw && VALID_EVENT_TYPES.has(typeFilterRaw) ? (typeFilterRaw as EventType) : undefined;

    const page = await listEventsPage(userId, { take, cursor, type });
    return NextResponse.json(page);
  } catch (err) {
    return jsonError(err);
  }
}
