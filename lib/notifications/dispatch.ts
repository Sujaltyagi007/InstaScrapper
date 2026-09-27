import type { NotificationProvider } from "@prisma/client";
import { sendNtfy } from "./providers/ntfy";
import { sendDiscord } from "./providers/discord";
import { sendWebhook } from "./providers/webhook";
import { sendWebPush } from "./providers/webpush";
import type { ChannelConfig, NotificationMessage, DiscordConfig, NtfyConfig, WebhookConfig } from "./types";

/**
 * `ctx.userId` is the channel owner. Web Push uses it to find that user's
 * devices (its config is deliberately empty, so a device list can never be
 * pointed at from a crafted channel config).
 */
export async function dispatchToProvider(
  provider: NotificationProvider,
  config: ChannelConfig,
  message: NotificationMessage,
  ctx: { userId: string },
): Promise<void> {
  switch (provider) {
    case "DISCORD":
      return sendDiscord(config as DiscordConfig, message);
    case "NTFY":
      return sendNtfy(config as NtfyConfig, message);
    case "WEBHOOK":
      return sendWebhook(config as WebhookConfig, message);
    case "WEBPUSH":
      return sendWebPush(ctx.userId, message);
    default:
      throw new Error(`Unknown notification provider: ${provider}`);
  }
}
