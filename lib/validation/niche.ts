import { z } from "zod";

export const saveNicheSchema = z.object({
  name: z.string().trim().min(2, "Name your niche (at least 2 characters).").max(80),
  description: z.string().trim().max(500).nullable().optional(),
  language: z.string().trim().min(2).max(40).optional(),
});

export const addNicheAccountSchema = z.object({
  username: z.string().trim().min(1).max(60),
  source: z.enum(["USER", "SUGGESTED"]).default("USER"),
});
