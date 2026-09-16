import { assertPublicHttpUrl } from "@/lib/security/ssrf";
import type { DiscordConfig, NotificationMessage } from "../types";

export async function sendDiscord(config: DiscordConfig, message: NotificationMessage): Promise<void> {
  await assertPublicHttpUrl(config.webhookUrl);

  const res = await fetch(config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: message.title,
        description: message.body,
        url: message.url,
        footer: { text: `@${message.targetUsername} • ${message.eventType}` },
        timestamp: new Date().toISOString(),
      }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook responded ${res.status}: ${await safeText(res)}`);
  }
}

async function safeText(res: Response) {
  try { return await res.text(); }
  catch { return "<no body>"; }
}
