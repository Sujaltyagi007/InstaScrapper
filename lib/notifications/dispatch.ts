import type { NotificationProvider } from "@prisma/client";
import { sendNtfy } from "./providers/ntfy";
import { sendDiscord } from "./providers/discord";
import { sendWebhook } from "./providers/webhook";
import type { ChannelConfig, NotificationMessage, DiscordConfig, NtfyConfig, WebhookConfig } from "./types";

export async function dispatchToProvider(provider: NotificationProvider, config: ChannelConfig, message: NotificationMessage): Promise<void> {
  switch (provider) {
    case "DISCORD":
      return sendDiscord(config as DiscordConfig, message);
    case "NTFY":
      return sendNtfy(config as NtfyConfig, message);
    case "WEBHOOK":
      return sendWebhook(config as WebhookConfig, message);
    default:
      throw new Error(`Unknown notification provider: ${provider}`);
  }
}
