import crypto from "crypto";
import { assertPublicHttpUrl } from "@/lib/security/ssrf";
import type { WebhookConfig, NotificationMessage } from "../types";

export async function sendWebhook(config: WebhookConfig, message: NotificationMessage): Promise<void> {
  await assertPublicHttpUrl(config.url);

  const payload = JSON.stringify({
    title: message.title,
    body: message.body,
    url: message.url,
    eventType: message.eventType,
    targetUsername: message.targetUsername,
    sentAt: new Date().toISOString(),
  });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.secret) {
    const signature = crypto.createHmac("sha256", config.secret).update(payload).digest("hex");
    headers["X-Signature-256"] = `sha256=${signature}`;
  }

  const res = await fetch(config.url, { method: "POST", headers, body: payload, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`Webhook responded ${res.status}: ${await safeText(res)}`);
  }
}

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
