import { Prisma, EventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DetectedChange } from "./diff.service";
import { enqueueNotificationsForEvent } from "./notification.service";

export async function recordEvent(params: { targetId: string; userId: string; change: DetectedChange }) {
  const { targetId, userId, change } = params;

  const existing = await prisma.event.findUnique({
    where: { targetId_fingerprint: { targetId, fingerprint: change.fingerprint } },
  });
  if (existing) return { event: existing, created: false };

  const event = await prisma.event.create({
    data: {
      targetId,
      userId,
      type: change.type,
      fingerprint: change.fingerprint,
      before: (change.before as Prisma.InputJsonValue) ?? undefined,
      after: (change.after as Prisma.InputJsonValue) ?? undefined,
      status: "PENDING",
    },
  });

  await enqueueNotificationsForEvent(event.id);

  return { event, created: true };
}

export async function markEventProcessed(eventId: string) {
  await prisma.event.update({
    where: { id: eventId },
    data: { status: "PROCESSED", processedAt: new Date() },
  });
}

/**
 * One cursor-paginated page of a user's events, newest first. Shared by
 * `GET /api/events` and the dashboard's server-rendered first page, so the
 * query lives in one place.
 */
export async function listEventsPage(
  userId: string,
  opts: { take?: number; cursor?: string; type?: EventType } = {},
) {
  const take = Math.min(opts.take ?? 25, 100);
  const events = await prisma.event.findMany({
    where: { userId, ...(opts.type ? { type: opts.type } : {}) },
    include: { target: { select: { username: true, id: true } } },
    orderBy: { detectedAt: "desc" },
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = events.length > take;
  const page = hasMore ? events.slice(0, take) : events;
  return { events: page, nextCursor: hasMore ? page[page.length - 1].id : null };
}
