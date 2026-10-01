import { GraphApiError, graphGet } from "./graph-client";
import { Capability, type CapabilityCheck, type GraphAccountConfig, type MetaProvider, type NormalizedMediaItem, type NormalizedProfile, type ResolvedAccountType, type TargetFetchResult, type TargetResolution } from "./types";

const MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "thumbnail_url",
  "permalink",
  "timestamp",
  "like_count",
  "comments_count",
  "view_count",
].join(",");

const PROFILE_FIELDS = [
  "id",
  "username",
  "name",
  "biography",
  "website",
  "followers_count",
  "media_count",
  "profile_picture_url",
].join(",");

/** How many recent posts to pull per check. Enough to catch bursts between polls. */
const MEDIA_LIMIT = 25;

interface BusinessDiscoveryMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  view_count?: number;
}

interface BusinessDiscoveryNode {
  id?: string;
  username?: string;
  name?: string;
  biography?: string;
  website?: string;
  followers_count?: number;
  media_count?: number;
  profile_picture_url?: string;
  media?: { data?: BusinessDiscoveryMedia[] };
}

interface BusinessDiscoveryResponse {
  business_discovery?: BusinessDiscoveryNode;
  id?: string;
}

function classifyGraphError(err: GraphApiError): {
  authError?: boolean;
  rateLimited?: boolean;
  notFound?: boolean;
  unsupported?: boolean;
  message: string;
} {
  const msg = err.message || "Graph API request failed.";
  if (err.code === 190 || err.code === 102 || err.code === 10 || err.code === 200) {
    return { authError: true, message: `Instagram connection needs to be re-authorized: ${msg}` };
  }
  if (err.code === 4 || err.code === 17 || err.code === 32 || err.code === 613) {
    return { rateLimited: true, message: `Graph API rate limit reached: ${msg}` };
  }
  const lowered = msg.toLowerCase();
  if (lowered.includes("does not exist") || lowered.includes("cannot be found") || lowered.includes("not found")) {
    return { notFound: true, message: "That Instagram username doesn't exist." };
  }
  if (
    lowered.includes("not a business") ||
    lowered.includes("not a professional") ||
    lowered.includes("business account") ||
    lowered.includes("unsupported get request")
  ) {
    return {
      unsupported: true,
      message:
        "That account isn't a public Business/Creator account, so the official Instagram API can't read it.",
    };
  }
  return { message: msg };
}

function normalizeMediaType(item: BusinessDiscoveryMedia): NormalizedMediaItem["mediaType"] {
  const permalink = item.permalink ?? "";
  if (/\/reels?\//i.test(permalink)) return "REEL";
  switch ((item.media_type ?? "").toUpperCase()) {
    case "VIDEO":
      return "VIDEO";
    case "CAROUSEL_ALBUM":
      return "CAROUSEL_ALBUM";
    default:
      return "IMAGE";
  }
}

function normalizeMedia(items: BusinessDiscoveryMedia[]): NormalizedMediaItem[] {
  return items.map((item) => {
    const mediaType = normalizeMediaType(item);
    const isVideo = mediaType === "VIDEO" || mediaType === "REEL";
    return {
      externalMediaId: item.id,
      mediaType,
      permalink: item.permalink ?? null,
      timestamp: item.timestamp ?? null,
      caption: item.caption ?? null,
      // For video, media_url IS the mp4 and thumbnail_url is the poster frame.
      mediaUrl: isVideo ? (item.thumbnail_url ?? item.media_url ?? null) : (item.media_url ?? null),
      videoUrl: isVideo ? (item.media_url ?? null) : null,
      isStory: false,
      metrics: {
        playCount: typeof item.view_count === "number" ? item.view_count : null,
        likeCount: typeof item.like_count === "number" ? item.like_count : null,
        commentCount: typeof item.comments_count === "number" ? item.comments_count : null,
        audioTitle: null,
        audioArtist: null,
        audioIsOriginal: null,
      },
    };
  });
}

function normalizeProfile(node: BusinessDiscoveryNode, fallbackUsername: string): NormalizedProfile {
  return {
    username: node.username ?? fallbackUsername,
    name: node.name ?? null,
    biography: node.biography ?? null,
    website: node.website ?? null,
    profilePictureUrl: node.profile_picture_url ?? null,
    followersCount: typeof node.followers_count === "number" ? node.followers_count : null,
    followsCount: null,
    mediaCount: typeof node.media_count === "number" ? node.media_count : null,
    isPrivate: false,
  };
}

function capabilitiesForBusinessDiscovery(): CapabilityCheck[] {
  return [
    { capability: Capability.TARGET_LOOKUP_BY_USERNAME, result: "AVAILABLE" },
    { capability: Capability.TARGET_PUBLIC_PROFILE_FIELDS, result: "AVAILABLE" },
    { capability: Capability.TARGET_PUBLIC_MEDIA, result: "AVAILABLE" },
    { capability: Capability.TARGET_FOLLOWER_COUNT, result: "AVAILABLE" },
    { capability: Capability.TARGET_FOLLOWING_COUNT, result: "UNAVAILABLE", reason: "Business Discovery doesn't return the target's following count." },
    { capability: Capability.TARGET_STORY_DATA, result: "UNAVAILABLE", reason: "Instagram never exposes stories for accounts you don't own." },
    {
      capability: Capability.TARGET_FOLLOWER_IDENTITY_LIST,
      result: "UNAVAILABLE",
      reason: "Instagram never exposes who follows an account you don't own.",
    },
    {
      capability: Capability.TARGET_WEBHOOK_EVENTS,
      result: "UNAVAILABLE",
      reason: "Webhooks require the target to authorize your app, so new posts are found by polling.",
    },
  ];
}

export class GraphMetaProvider implements MetaProvider {
  constructor() {
    if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
      throw new Error(
        "META_APP_ID and META_APP_SECRET are required for INSTAGRAM_PROVIDER_MODE=GRAPH. " +
        "Create a Business-type Meta app and add them to your environment.",
      );
    }
  }

  private async businessDiscovery(username: string, account: GraphAccountConfig, withMedia: boolean): Promise<BusinessDiscoveryNode> {
    const inner = withMedia ? `${PROFILE_FIELDS},media.limit(${MEDIA_LIMIT}){${MEDIA_FIELDS}}` : PROFILE_FIELDS;
    const res = await graphGet<BusinessDiscoveryResponse>(`/${account.igUserId}`, {
      fields: `business_discovery.username(${username}){${inner}}`,
      access_token: account.accessToken,
    });
    const node = res.business_discovery;
    if (!node) {
      throw new GraphApiError(
        "That account isn't a public Business/Creator account, so the official Instagram API can't read it.",
        400,
      );
    }
    return node;
  }

  async resolveTarget(username: string, _session?: unknown, graphAccount?: GraphAccountConfig | null): Promise<TargetResolution> {
    if (!graphAccount) {
      return {
        username,
        externalId: null,
        accountType: "UNKNOWN",
        eligibility: "TEMPORARILY_UNAVAILABLE",
        capabilities: [],
        errorCode: "NO_META_CONNECTION",
        errorMessage: "Connect your Instagram professional account in Settings first.",
      };
    }

    try {
      const node = await this.businessDiscovery(username, graphAccount, false);
      const accountType: ResolvedAccountType = "BUSINESS";
      return {
        username: node.username ?? username,
        externalId: node.id ?? null,
        accountType,
        eligibility: "SUPPORTED",
        capabilities: capabilitiesForBusinessDiscovery(),
      };
    } catch (error) {
      if (error instanceof GraphApiError) {
        const c = classifyGraphError(error);
        return {
          username,
          externalId: null,
          accountType: "UNKNOWN",
          eligibility: c.notFound
            ? "UNSUPPORTED"
            : c.unsupported
              ? "UNSUPPORTED"
              : "TEMPORARILY_UNAVAILABLE",
          capabilities: [],
          errorCode: c.authError
            ? "META_AUTH_ERROR"
            : c.rateLimited
              ? "RATE_LIMITED"
              : c.notFound
                ? "NOT_FOUND"
                : c.unsupported
                  ? "NOT_PROFESSIONAL_ACCOUNT"
                  : "TEMPORARY_FAILURE",
          errorMessage: c.message,
        };
      }
      return {
        username,
        externalId: null,
        accountType: "UNKNOWN",
        eligibility: "TEMPORARILY_UNAVAILABLE",
        capabilities: [],
        errorCode: "TEMPORARY_FAILURE",
        errorMessage: error instanceof Error ? error.message : "Instagram lookup failed.",
      };
    }
  }

  async fetchTargetData(params: {
    username: string;
    externalId: string | null;
    accessToken?: string;
    graphAccount?: GraphAccountConfig | null;
  }): Promise<TargetFetchResult> {
    const { username, graphAccount } = params;
    if (!graphAccount) {
      return {
        ok: false,
        authError: true,
        errorMessage: "No connected Instagram account. Connect one in Settings.",
      };
    }

    try {
      const node = await this.businessDiscovery(username, graphAccount, true);
      return {
        ok: true,
        profile: normalizeProfile(node, username),
        media: normalizeMedia(node.media?.data ?? []),
        // Structurally unavailable through this API — not "turned off".
        stories: [],
      };
    } catch (error) {
      if (error instanceof GraphApiError) {
        const c = classifyGraphError(error);
        return {
          ok: false,
          authError: c.authError,
          rateLimited: c.rateLimited,
          notFound: c.notFound,
          temporaryFailure: !c.authError && !c.rateLimited && !c.notFound,
          errorMessage: c.message,
        };
      }
      return {
        ok: false,
        temporaryFailure: true,
        errorMessage: error instanceof Error ? error.message : "Instagram fetch failed.",
      };
    }
  }
}
