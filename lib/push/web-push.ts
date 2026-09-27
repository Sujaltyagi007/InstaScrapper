/**
 * Web Push (VAPID) configuration. Keys come from env: NEXT_PUBLIC_VAPID_PUBLIC_KEY
 * (safe to expose, the browser needs it to subscribe) and VAPID_PRIVATE_KEY.
 */
import webpush from "web-push";

export function vapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null;
}

export function isPushConfigured(): boolean {
  return Boolean(vapidPublicKey() && process.env.VAPID_PRIVATE_KEY?.trim());
}

/**
 * Push services use this to contact the sender about abuse. Must be an https
 * URL or a mailto: address; falls back to the app URL, then a placeholder.
 */
function vapidSubject(): string {
  const explicit = process.env.VAPID_SUBJECT?.trim();
  if (explicit) return explicit;
  const appUrl = (process.env.APP_URL || process.env.NEXTAUTH_URL || "").trim();
  if (appUrl.startsWith("https://")) return appUrl;
  return "mailto:push-admin@example.com";
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Page to open when the notification is clicked (same-origin path or URL). */
  url?: string;
  /** Notifications with the same tag replace each other instead of stacking. */
  tag?: string;
}

export class PushGoneError extends Error {}

/** Sends one push. Throws PushGoneError when the subscription no longer exists (404/410). */
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<void> {
  const publicKey = vapidPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) throw new Error("Web Push isn't configured on the server (VAPID keys missing).");

  // Push services cap payloads at ~4 KB; keep the body short.
  const body = payload.body.length > 400 ? `${payload.body.slice(0, 397)}…` : payload.body;
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify({ ...payload, body }),
      {
        vapidDetails: { subject: vapidSubject(), publicKey, privateKey },
        TTL: 24 * 60 * 60, // drop it if the device stays offline for a day
        urgency: "normal",
        timeout: 10_000,
      },
    );
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) throw new PushGoneError("Subscription expired.");
    throw err;
  }
}
