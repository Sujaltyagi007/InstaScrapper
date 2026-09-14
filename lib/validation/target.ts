import { z } from "zod";

export const resolveTargetSchema = z.object({
  username: z.string().min(1).max(60),
});

export const createTargetSchema = z.object({
  username: z.string().min(1).max(60),
  engineType: z.enum(["STEALTH_SCRAPER", "META_GRAPH"]).default("STEALTH_SCRAPER"),
  watchNewMedia: z.boolean().default(true),
  watchProfile: z.boolean().default(true),
  watchFollowerCount: z.boolean().default(false),
  watchFollowingCount: z.boolean().default(false),
  watchStories: z.boolean().default(true),
  watchReels: z.boolean().default(true),
  watchFollowerChurn: z.boolean().default(false),
  watchCollabPosts: z.boolean().default(true),
  jitterEnabled: z.boolean().default(true),
  humanSimEnabled: z.boolean().default(false),
  restrictedHoursEnabled: z.boolean().default(false),
  restrictedHoursStart: z.number().int().min(0).max(23).default(8),
  restrictedHoursEnd: z.number().int().min(0).max(23).default(23),
  instagramSessionId: z.string().nullable().optional(),
  followerThreshold: z.number().int().min(0).optional(),
  intervalSeconds: z.number().int().min(60).default(5400),
  notificationChannelIds: z.array(z.string()).default([]),
});

export const updateMonitorSchema = z.object({
  engineType: z.enum(["STEALTH_SCRAPER", "META_GRAPH"]).optional(),
  watchNewMedia: z.boolean().optional(),
  watchProfile: z.boolean().optional(),
  watchFollowerCount: z.boolean().optional(),
  watchFollowingCount: z.boolean().optional(),
  watchStories: z.boolean().optional(),
  watchReels: z.boolean().optional(),
  watchFollowerChurn: z.boolean().optional(),
  watchCollabPosts: z.boolean().optional(),
  jitterEnabled: z.boolean().optional(),
  humanSimEnabled: z.boolean().optional(),
  restrictedHoursEnabled: z.boolean().optional(),
  restrictedHoursStart: z.number().int().min(0).max(23).optional(),
  restrictedHoursEnd: z.number().int().min(0).max(23).optional(),
  instagramSessionId: z.string().nullable().optional(),
  followerThreshold: z.number().int().min(0).nullable().optional(),
  intervalSeconds: z.number().int().min(60).optional(),
  active: z.boolean().optional(),
  notificationChannelIds: z.array(z.string()).optional(),
});
