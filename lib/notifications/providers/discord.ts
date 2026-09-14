import type { DiscordConfig, NotificationMessage } from "../types";

export async function sendDiscord(config: DiscordConfig, message: NotificationMessage): Promise<void> {
  const res = await fetch(config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: message.title,
          description: message.body,
          url: message.url,
          footer: { text: `@${message.targetUsername} • ${message.eventType}` },
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook responded ${res.status}: ${await safeText(res)}`);
  }
}

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
