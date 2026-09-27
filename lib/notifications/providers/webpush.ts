import { prisma } from "@/lib/prisma";
import { PushGoneError, sendPush } from "@/lib/push/web-push";
import type { NotificationMessage } from "../types";

/**
 * Sends to every device the user has subscribed. Expired subscriptions are
 * deleted. Throws only when devices exist and none of them could be reached,
 * so the notification pipeline retries it like any other channel.
 */
export async function sendWebPush(userId: string, message: NotificationMessage): Promise<void> {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return;

  const payload = {
    title: message.title,
    body: message.body,
    url: message.appPath ?? message.url ?? "/",
    tag: message.tag,
  };

  const results = await Promise.allSettled(subs.map((s) => sendPush(s, payload)));
  let delivered = 0;
  const errors: string[] = [];
  await Promise.all(
    results.map((r, i) => {
      const sub = subs[i];
      if (r.status === "fulfilled") {
        delivered++;
        return prisma.pushSubscription
          .update({ where: { id: sub.id }, data: { lastSuccessAt: new Date(), failureCount: 0 } })
          .catch(() => {});
      }
      if (r.reason instanceof PushGoneError) {
        return prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      }
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      return prisma.pushSubscription
        .update({ where: { id: sub.id }, data: { failureCount: { increment: 1 } } })
        .catch(() => {});
    }),
  );

  if (delivered === 0 && errors.length > 0) {
    throw new Error(`Push failed on every device: ${errors[0]}`.slice(0, 300));
  }
}
