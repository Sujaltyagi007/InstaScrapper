import { Prisma } from "@prisma/client";
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
