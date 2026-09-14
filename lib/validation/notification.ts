import { z } from "zod";

const eventTypeEnum = z.enum([
  "NEW_MEDIA",
  "MEDIA_UPDATED",
  "PROFILE_CHANGED",
  "FOLLOWER_COUNT_CHANGED",
  "FOLLOWING_COUNT_CHANGED",
  "ACCOUNT_UNAVAILABLE",
  "ACCOUNT_RENAMED",
  "RATE_LIMITED",
]);

const discordConfigSchema = z.object({
  provider: z.literal("DISCORD"),
  webhookUrl: z.string().url(),
});

const ntfyConfigSchema = z.object({
  provider: z.literal("NTFY"),
  serverUrl: z.string().url(),
  topic: z.string().min(1).max(64),
  accessToken: z.string().optional(),
});

const webhookConfigSchema = z.object({
  provider: z.literal("WEBHOOK"),
  url: z.string().url(),
  secret: z.string().optional(),
});

export const notificationConfigSchema = z.discriminatedUnion("provider", [
  discordConfigSchema,
  ntfyConfigSchema,
  webhookConfigSchema,
]);

export const createNotificationChannelSchema = z.object({
  name: z.string().min(1).max(80),
  config: notificationConfigSchema,
  eventTypeFilter: z.array(eventTypeEnum).default([]),
  cooldownSeconds: z.number().int().min(0).max(24 * 60 * 60).default(0),
  enabled: z.boolean().default(true),
});

export const updateNotificationChannelSchema = createNotificationChannelSchema.partial();
