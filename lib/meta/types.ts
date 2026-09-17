export enum Capability {
  TARGET_LOOKUP_BY_USERNAME = "TARGET_LOOKUP_BY_USERNAME",
  TARGET_PUBLIC_PROFILE_FIELDS = "TARGET_PUBLIC_PROFILE_FIELDS",
  TARGET_PUBLIC_MEDIA = "TARGET_PUBLIC_MEDIA",
  TARGET_FOLLOWER_COUNT = "TARGET_FOLLOWER_COUNT",
  TARGET_FOLLOWING_COUNT = "TARGET_FOLLOWING_COUNT",
  TARGET_WEBHOOK_EVENTS = "TARGET_WEBHOOK_EVENTS",
  TARGET_STORY_DATA = "TARGET_STORY_DATA",
  TARGET_FOLLOWER_IDENTITY_LIST = "TARGET_FOLLOWER_IDENTITY_LIST",
}

export type CapabilityResult =
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "NOT_AUTHORIZED"
  | "NOT_SUPPORTED_FOR_TARGET"
  | "RATE_LIMITED"
  | "TEMPORARY_FAILURE";

export interface CapabilityCheck {
  capability: Capability;
  result: CapabilityResult;
  reason?: string;
}

export type ResolvedAccountType = "BUSINESS" | "CREATOR" | "PERSONAL" | "UNKNOWN";

export type TargetEligibilityResult =
  | "SUPPORTED"
  | "PARTIALLY_SUPPORTED"
  | "UNSUPPORTED"
  | "PRIVATE_UNAVAILABLE"
  | "TEMPORARILY_UNAVAILABLE";

export interface TargetResolution {
  username: string;
  externalId: string | null;
  accountType: ResolvedAccountType;
  eligibility: TargetEligibilityResult;
  capabilities: CapabilityCheck[];
  errorCode?: string;
  errorMessage?: string;
}

export interface NormalizedProfile {
  username: string;
  name: string | null;
  biography: string | null;
  website: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
  reelsCount?: number | null;
  hasStory?: boolean;
  storiesCount?: number | null;
  isPrivate?: boolean;
}

export interface NormalizedMediaItem {
  externalMediaId: string;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "REEL";
  permalink: string | null;
  timestamp: string | null;
  caption: string | null;
  mediaUrl: string | null;
  videoUrl?: string | null;
  isStory?: boolean;
  isCollab?: boolean;
  collaborators?: string[];
}

export interface TargetFetchResult {
  ok: boolean;
  rateLimited?: boolean;
  temporaryFailure?: boolean;
  notFound?: boolean;
  authError?: boolean;
  sessionFlagged?: boolean;
  profile?: NormalizedProfile;
  media?: NormalizedMediaItem[];
  stories?: NormalizedMediaItem[];
  followersList?: string[];
  followingList?: string[];
  errorMessage?: string;
  anonymousMode?: boolean;
  deviceId?: string;
}

export interface StealthFetchOptions {
  watchStories?: boolean;
  watchReels?: boolean;
  watchFollowerChurn?: boolean;
  watchCollabPosts?: boolean;
  jitterEnabled?: boolean;
  humanSimEnabled?: boolean;
  proxyUrl?: string | null;
  /**
   * Epoch ms by which the check must be done. Scheduled runs pass their time
   * budget so retries stop early instead of the serverless function being
   * killed mid-request (Vercel Hobby caps functions at ~60s).
   */
  deadlineAt?: number;
}

export interface StealthSessionConfig {
  username: string;
  cookies: Record<string, string>;
  userAgent?: string | null;
  
  impersonateTarget?: string;
  proxyUrl?: string | null;
  deviceId?: string | null;
}

export interface MetaProvider {
  resolveTarget(username: string, session?: StealthSessionConfig | null): Promise<TargetResolution>;
  fetchTargetData(params: {
    username: string;
    externalId: string | null;
    accessToken?: string;
    session?: StealthSessionConfig | null;
    options?: StealthFetchOptions;
  }): Promise<TargetFetchResult>;
}
