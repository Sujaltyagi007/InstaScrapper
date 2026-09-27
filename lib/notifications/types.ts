export interface NotificationMessage {
  title: string;
  body: string;
  url?: string;
  eventType: string;
  targetUsername: string;
  /** In-app page to open from a push notification (e.g. /targets/abc). Other providers ignore it. */
  appPath?: string;
  /** Push only: notifications sharing a tag replace each other instead of stacking. */
  tag?: string;
}

/** Web Push channels carry no config: delivery goes to the channel owner's subscribed devices. */
export type WebPushConfig = Record<string, never>;

export interface DiscordConfig {
  webhookUrl: string;
}

export interface NtfyConfig {
  serverUrl: string; // e.g. https://ntfy.sh or a self-hosted server
  topic: string;
  accessToken?: string;
}

export interface WebhookConfig {
  url: string;
  secret?: string; // used to sign the payload via HMAC-SHA256 if present
}

export type ChannelConfig = DiscordConfig | NtfyConfig | WebhookConfig | WebPushConfig;
