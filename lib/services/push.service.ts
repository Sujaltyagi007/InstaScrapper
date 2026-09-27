/**
 * Browser push: device subscriptions and the per-user "Browser push" channel.
 *
 * Each user gets at most one WEBPUSH NotificationChannel, created on their first
 * subscribed device. It rides the normal notification pipeline, so its
 * eventTypeFilter/enabled flag are the push preferences and delivery, retries and
 * cooldowns work exactly like Discord/ntfy. Devices live in PushSubscription.
 */
import type { EventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-helpers";
import { assertPublicHttpUrl } from "@/lib/security/ssrf";
import { buildEncryptedConfig } from "@/lib/services/notification.service";
import { isPushConfigured, PushGoneError, sendPush, vapidPublicKey } from "@/lib/push/web-push";

export const PUSH_CHANNEL_NAME = "Browser push";

/** "Chrome on Android", "Safari on iPhone"… from a user-agent string. */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Browser";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  return os ? `${browser} on ${os}` : browser;
}

function getPushChannel(userId: string) {
  return prisma.notificationChannel.findFirst({ where: { userId, provider: "WEBPUSH" }, orderBy: { createdAt: "asc" } });
}

async function ensurePushChannel(userId: string) {
  const existing = await getPushChannel(userId);
  if (existing) return existing;
  const { encryptedConfig, encryptedConfigIv } = buildEncryptedConfig("WEBPUSH", {});
  return prisma.notificationChannel.create({
    data: {
      userId,
      name: PUSH_CHANNEL_NAME,
      provider: "WEBPUSH",
      encryptedConfig,
      encryptedConfigIv,
      eventTypeFilter: [], // empty = every event type
      enabled: true,
    },
  });
}

export interface IncomingSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function saveSubscription(userId: string, sub: IncomingSubscription, userAgent: string | null) {
  if (!isPushConfigured()) throw new ApiError(503, "Push notifications aren't set up on the server yet.");
  // The server POSTs to this URL on every notification, so it must be a real public https push service.
  if (!sub.endpoint.startsWith("https://")) throw new ApiError(400, "That isn't a valid push subscription.");
  await assertPublicHttpUrl(sub.endpoint);

  const label = deviceLabel(userAgent);
  const saved = await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    // Same browser re-subscribing, possibly after switching accounts: it belongs to whoever is signed in now.
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, label, userAgent, failureCount: 0 },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, label, userAgent },
  });
  const channel = await ensurePushChannel(userId);
  // Turning push on for a device means the user wants push: re-enable the channel if it was off.
  if (!channel.enabled) await prisma.notificationChannel.update({ where: { id: channel.id }, data: { enabled: true } });
  return saved;
}

export async function removeSubscription(userId: string, by: { id?: string; endpoint?: string }) {
  if (!by.id && !by.endpoint) throw new ApiError(400, "Say which device to remove.");
  const { count } = await prisma.pushSubscription.deleteMany({
    where: { userId, ...(by.id ? { id: by.id } : { endpoint: by.endpoint }) },
  });
  return { removed: count };
}

export async function getPushState(userId: string) {
  const [channel, devices] = await Promise.all([
    getPushChannel(userId),
    prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, endpoint: true, label: true, createdAt: true, lastSuccessAt: true, failureCount: true },
    }),
  ]);
  return {
    configured: isPushConfigured(),
    publicKey: vapidPublicKey(),
    preferences: channel
      ? { channelId: channel.id, enabled: channel.enabled, eventTypes: channel.eventTypeFilter }
      : { channelId: null, enabled: true, eventTypes: [] as EventType[] },
    devices,
  };
}

export async function updatePushPreferences(userId: string, prefs: { enabled?: boolean; eventTypes?: EventType[] }) {
  const channel = await ensurePushChannel(userId);
  await prisma.notificationChannel.update({
    where: { id: channel.id },
    data: {
      ...(prefs.enabled !== undefined ? { enabled: prefs.enabled } : {}),
      ...(prefs.eventTypes !== undefined ? { eventTypeFilter: prefs.eventTypes } : {}),
    },
  });
  return getPushState(userId);
}

/** Sends a test push to one device (by endpoint) or all of the user's devices. */
export async function sendPushTest(userId: string, endpoint?: string) {
  const subs = await prisma.pushSubscription.findMany({ where: { userId, ...(endpoint ? { endpoint } : {}) } });
  if (subs.length === 0) throw new ApiError(404, "No device is subscribed yet. Turn on notifications first.");
  let sent = 0;
  for (const s of subs) {
    try {
      await sendPush(s, {
        title: "Notifications are working",
        body: "You'll get alerts like this when something changes on an account you monitor.",
        url: "/notifications",
        tag: "test",
      });
      sent++;
      await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastSuccessAt: new Date(), failureCount: 0 } });
    } catch (err) {
      if (err instanceof PushGoneError) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      else console.warn("[push] test failed:", err instanceof Error ? err.message : err);
    }
  }
  if (sent === 0) throw new ApiError(502, "Couldn't reach your device. Turn notifications off and on again.");
  return { sent };
}
