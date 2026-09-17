import { z } from "zod";
import { isValidTimeZone } from "@/lib/scheduling/time-windows";

export const updateSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine(isValidTimeZone, "Unknown timezone. Use an IANA name like Asia/Kolkata.")
    .optional(),
  sleepEnabled: z.boolean().optional(),
  sleepStartHour: z.number().int().min(0).max(23).optional(),
  sleepEndHour: z.number().int().min(0).max(23).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
});
