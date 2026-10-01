import { z } from "zod";
import { KEY_PROVIDERS } from "@/lib/ai/key-detect";

export const addKeySchema = z.object({
  provider: z.enum(KEY_PROVIDERS),
  key: z.string().min(1).max(1000),
  /** Save even though the provider couldn't be reached to check it (never a rejected key). */
  force: z.boolean().optional(),
});

export const keyActionSchema = z.object({ action: z.literal("recheck") });
