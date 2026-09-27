import { z } from "zod";
import { EventType } from "@prisma/client";

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(128),
  }),
});

export const pushPreferencesSchema = z
  .object({
    enabled: z.boolean().optional(),
    eventTypes: z.array(z.enum(Object.values(EventType) as [EventType, ...EventType[]])).max(50).optional(),
  })
  .refine((v) => v.enabled !== undefined || v.eventTypes !== undefined, "Nothing to update.");

export const pushTestSchema = z.object({ endpoint: z.string().url().max(2048).optional() });
