import { z } from "zod";

export const updateSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  timezone: z.string().min(1).max(64).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
});
