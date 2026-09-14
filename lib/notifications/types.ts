export interface NotificationMessage {
  title: string;
  body: string;
  url?: string;
  eventType: string;
  targetUsername: string;
}

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

export type ChannelConfig = DiscordConfig | NtfyConfig | WebhookConfig;
