import { prisma } from "@/lib/prisma";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { dispatchToProvider } from "@/lib/notifications/dispatch";
import type { ChannelConfig, NotificationMessage } from "@/lib/notifications/types";
import type { Event, EventType, NotificationProvider } from "@prisma/client";

const MAX_ATTEMPTS = 6;

function backoffMs(attempts: number): number {
  const base = 30_000; // 30s
  const capped = Math.min(base * 2 ** attempts, 60 * 60 * 1000); // cap at 1h
  return capped;
}

function eventTitle(type: EventType, username: string): string {
  switch (type) {
    case "NEW_MEDIA":
      return `New post from @${username}`;
    case "MEDIA_UPDATED":
      return `Post updated for @${username}`;
    case "NEW_STORY":
      return `📖 New story from @${username}`;
    case "NEW_REEL":
      return `🎬 New reel from @${username}`;
    case "FOLLOWER_CHURN":
      return `👥 Follower churn detected for @${username}`;
    case "COLLAB_POST_LEAKED":
      return `🕵️ Leaked collab post for @${username}`;
    case "PROFILE_CHANGED":
      return `Profile changed for @${username}`;
    case "FOLLOWER_COUNT_CHANGED":
      return `Follower count changed for @${username}`;
    case "FOLLOWING_COUNT_CHANGED":
      return `Following count changed for @${username}`;
    case "ACCOUNT_UNAVAILABLE":
      return `@${username} is unavailable`;
    case "ACCOUNT_RENAMED":
      return `@${username} was renamed`;
    case "RATE_LIMITED":
      return `Rate limited while checking @${username}`;
    case "SESSION_FLAGGED":
      return `🚩 Instagram session flagged for @${username}`;
    default:
      return `Update for @${username}`;
  }
}

function eventBody(event: Pick<Event, "type" | "before" | "after">): string {
  const before = event.before as Record<string, unknown> | null;
  const after = event.after as Record<string, unknown> | null;
  if (event.type === "PROFILE_CHANGED" && before) {
    const fields = Object.keys(before);
    return `Changed fields: ${fields.join(", ")}`;
  }
  if (event.type === "FOLLOWER_COUNT_CHANGED" && before && after) {
    return `Followers: ${String(before.followersCount)} -> ${String(after.followersCount)}`;
  }
  if (event.type === "FOLLOWING_COUNT_CHANGED" && before && after) {
    return `Following: ${String(before.followsCount)} -> ${String(after.followsCount)}`;
  }
  if (event.type === "NEW_STORY" && after) {
    return after.caption ? `Story: ${String(after.caption)}` : "New story item posted.";
  }
  if (event.type === "NEW_REEL" && before && after) {
    return `Reels count: ${String(before.reelsCount)} -> ${String(after.reelsCount)}`;
  }
  if (event.type === "FOLLOWER_CHURN" && after) {
    const added = (after.added as string[])?.length ?? 0;
    const removed = (after.removed as string[])?.length ?? 0;
    return `Follower list changed: +${added} added, -${removed} removed.`;
  }
  if (event.type === "COLLAB_POST_LEAKED") {
    return "New private collab post revealed via public co-author.";
  }
  if (event.type === "SESSION_FLAGGED" && after) {
    return String(after.message ?? "Checkpoint or challenge required by Instagram.");
  }
  return "See your dashboard for details.";
}

export async function enqueueNotificationsForEvent(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { target: true },
  });

  const channels = await prisma.notificationChannel.findMany({
    where: {
      userId: event.userId,
      enabled: true,
    },
  });

  for (const channel of channels) {
    if (channel.eventTypeFilter.length > 0 && !channel.eventTypeFilter.includes(event.type)) { continue }

    if (channel.cooldownSeconds > 0) {
      const recent = await prisma.notification.findFirst({
        where: {
          channelId: channel.id,
          event: { targetId: event.targetId },
          OR: [
            { status: "SENT", sentAt: { gte: new Date(Date.now() - channel.cooldownSeconds * 1000) } },
            { status: { in: ["PENDING", "RETRYING"] } },
          ],
        },
      });
      if (recent) continue; // still in cooldown, or an earlier notification for this target/channel hasn't gone out yet
    }

    await prisma.notification.upsert({
      where: { eventId_channelId: { eventId: event.id, channelId: channel.id } },
      create: {
        eventId: event.id,
        channelId: channel.id,
        provider: channel.provider,
        status: "PENDING",
        nextAttemptAt: new Date(),
      },
      update: {},
    });
  }
}

/** Called by the notification-dispatch cron job. Processes due notifications with bounded concurrency. */
export async function dispatchDueNotifications(limit = 25) {
  const due = await prisma.notification.findMany({
    where: {
      status: { in: ["PENDING", "RETRYING"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    take: limit,
    include: {
      event: { include: { target: true } },
      channel: true,
    },
  });

  let sent = 0;
  let failed = 0;

  for (const notification of due) {
    try {
      const config = decryptJson<ChannelConfig>({
        ciphertext: notification.channel.encryptedConfig,
        iv: notification.channel.encryptedConfigIv,
      });

      const message: NotificationMessage = {
        title: eventTitle(notification.event.type, notification.event.target.username),
        body: eventBody(notification.event),
        eventType: notification.event.type,
        targetUsername: notification.event.target.username,
      };

      await dispatchToProvider(notification.provider, config, message);

      await prisma.notification.update({
        where: { id: notification.id },
        data: { status: "SENT", sentAt: new Date(), attempts: notification.attempts + 1, error: null },
      });
      sent++;
    } catch (err) {
      const attempts = notification.attempts + 1;
      const gaveUp = attempts >= MAX_ATTEMPTS;
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: gaveUp ? "FAILED" : "RETRYING",
          attempts,
          error: err instanceof Error ? err.message : String(err),
          nextAttemptAt: gaveUp ? null : new Date(Date.now() + backoffMs(attempts)),
        },
      });
      failed++;
    }
  }

  return { processed: due.length, sent, failed };
}

export async function sendTestNotification(channelId: string, userId: string) {
  const channel = await prisma.notificationChannel.findFirstOrThrow({
    where: { id: channelId, userId },
  });
  const config = decryptJson<ChannelConfig>({
    ciphertext: channel.encryptedConfig,
    iv: channel.encryptedConfigIv,
  });
  await dispatchToProvider(channel.provider, config, {
    title: "Test notification",
    body: `This is a test delivery from your monitoring app's "${channel.name}" channel.`,
    eventType: "TEST",
    targetUsername: "test",
  });
}

/**
 * Sends an account-level alert (not tied to a target or Event) straight to
 * every enabled channel the user has.
 *
 * Why not the Event queue: Events belong to a target (`targetId` is required
 * and cascades on delete), and an account alert like "limit reached" isn't
 * about any one target. Delivery here is best-effort and immediate; failures
 * are logged per channel and never thrown, so an unreachable webhook can't
 * break the action that triggered the alert.
 *
 * Channel `eventTypeFilter`s are intentionally ignored: they select which
 * *target* events a channel wants, and account alerts aren't one of those.
 */
export async function sendAccountAlert(
  userId: string,
  message: { title: string; body: string; kind: string; url?: string }
): Promise<{ sent: number; failed: number }> {
  const channels = await prisma.notificationChannel.findMany({
    where: { userId, enabled: true },
  });

  let sent = 0;
  let failed = 0;
  for (const channel of channels) {
    try {
      const config = decryptJson<ChannelConfig>({
        ciphertext: channel.encryptedConfig,
        iv: channel.encryptedConfigIv,
      });
      await dispatchToProvider(channel.provider, config, {
        title: message.title,
        body: message.body,
        url: message.url,
        eventType: message.kind,
        targetUsername: "account",
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      console.warn(
        `[account-alert] channel ${channel.id} (${channel.provider}) failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return { sent, failed };
}

export function buildEncryptedConfig(provider: NotificationProvider, rawConfig: ChannelConfig) {
  const encrypted = encryptJson(rawConfig);
  return { encryptedConfig: encrypted.ciphertext, encryptedConfigIv: encrypted.iv };
}
