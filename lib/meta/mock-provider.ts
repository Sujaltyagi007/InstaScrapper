import crypto from "crypto";
import type {
  MetaProvider,
  TargetResolution,
  TargetFetchResult,
  NormalizedMediaItem,
  CapabilityCheck,
} from "./types";
import { Capability } from "./types";



function hashToInt(input: string): number {
  const hash = crypto.createHash("sha256").update(input).digest();
  return hash.readUInt32BE(0);
}

// Username prefixes let you exercise every classification path deliberately.
const PREFIX_RULES: Array<{ prefix: string; build: (username: string) => TargetResolution }> = [
  {
    prefix: "private_",
    build: (username) => ({
      username,
      externalId: null,
      accountType: "UNKNOWN",
      eligibility: "PRIVATE_UNAVAILABLE",
      capabilities: [
        { capability: Capability.TARGET_LOOKUP_BY_USERNAME, result: "AVAILABLE" },
        { capability: Capability.TARGET_PUBLIC_PROFILE_FIELDS, result: "UNAVAILABLE", reason: "Account is private." },
      ],
    }),
  },
  {
    prefix: "personal_",
    build: (username) => ({
      username,
      externalId: null,
      accountType: "PERSONAL",
      eligibility: "UNSUPPORTED",
      capabilities: [
        { capability: Capability.TARGET_LOOKUP_BY_USERNAME, result: "AVAILABLE" },
        {
          capability: Capability.TARGET_PUBLIC_PROFILE_FIELDS,
          result: "NOT_SUPPORTED_FOR_TARGET",
          reason: "Personal/consumer accounts are not exposed via Business Discovery.",
        },
      ],
    }),
  },
  {
    prefix: "notfound_",
    build: (username) => ({
      username,
      externalId: null,
      accountType: "UNKNOWN",
      eligibility: "UNSUPPORTED",
      capabilities: [
        { capability: Capability.TARGET_LOOKUP_BY_USERNAME, result: "UNAVAILABLE", reason: "Username not found." },
      ],
      errorCode: "NOT_FOUND",
      errorMessage: "No Instagram account found for this username.",
    }),
  },
  {
    prefix: "unavailable_",
    build: (username) => ({
      username,
      externalId: `mock_${hashToInt(username)}`,
      accountType: "BUSINESS",
      eligibility: "TEMPORARILY_UNAVAILABLE",
      capabilities: [
        { capability: Capability.TARGET_LOOKUP_BY_USERNAME, result: "TEMPORARY_FAILURE", reason: "Simulated transient upstream failure." },
      ],
    }),
  },
];

function classifySupported(username: string): TargetResolution {
  const seed = hashToInt(username);
  const accountType = seed % 2 === 0 ? "BUSINESS" : "CREATOR";
  const capabilities: CapabilityCheck[] = [
    { capability: Capability.TARGET_LOOKUP_BY_USERNAME, result: "AVAILABLE" },
    { capability: Capability.TARGET_PUBLIC_PROFILE_FIELDS, result: "AVAILABLE" },
    { capability: Capability.TARGET_PUBLIC_MEDIA, result: "AVAILABLE" },
    { capability: Capability.TARGET_FOLLOWER_COUNT, result: "AVAILABLE" },
    { capability: Capability.TARGET_FOLLOWING_COUNT, result: "NOT_SUPPORTED_FOR_TARGET", reason: "Not exposed for this target." },
    { capability: Capability.TARGET_WEBHOOK_EVENTS, result: "NOT_SUPPORTED_FOR_TARGET" },
    { capability: Capability.TARGET_STORY_DATA, result: "NOT_SUPPORTED_FOR_TARGET" },
    { capability: Capability.TARGET_FOLLOWER_IDENTITY_LIST, result: "NOT_SUPPORTED_FOR_TARGET" },
  ];

  return {
    username,
    externalId: `mock_${seed}`,
    accountType,
    eligibility: "PARTIALLY_SUPPORTED",
    capabilities,
  };
}

function buildMockMedia(username: string, count: number): NormalizedMediaItem[] {
  const seed = hashToInt(username);
  return Array.from({ length: count }).map((_, i) => {
    const index = count - i; // most recent first, ascending ids
    const id = `mock_media_${seed}_${index}`;
    return {
      externalMediaId: id,
      mediaType: index % 5 === 0 ? "REEL" : index % 3 === 0 ? "VIDEO" : "IMAGE",
      permalink: `https://instagram.com/p/${id}`,
      timestamp: new Date(Date.now() - index * 6 * 60 * 60 * 1000).toISOString(),
      caption: `Mock post #${index} for @${username}`,
      mediaUrl: `https://picsum.photos/seed/${id}/600/600`,
    };
  });
}

export class MockMetaProvider implements MetaProvider {
  async resolveTarget(rawUsername: string): Promise<TargetResolution> {
    const username = rawUsername.trim().toLowerCase();

    for (const rule of PREFIX_RULES) {
      if (username.startsWith(rule.prefix)) return rule.build(username);
    }

    return classifySupported(username);
  }

  async fetchTargetData(params: {
    username: string;
    externalId: string | null;
  }): Promise<TargetFetchResult> {
    const { username } = params;

    if (username.startsWith("ratelimited_")) {
      return { ok: false, rateLimited: true, errorMessage: "Simulated rate limit (mock provider)." };
    }
    if (username.startsWith("unavailable_")) {
      return { ok: false, temporaryFailure: true, errorMessage: "Simulated transient failure (mock provider)." };
    }
    if (username.startsWith("notfound_")) {
      return { ok: false, notFound: true, errorMessage: "Account no longer found (mock provider)." };
    }

    const seed = hashToInt(username);
    // Media count "grows" slowly over time so scheduled polling has
    // something new to find without requiring manual intervention.
    const hoursSinceEpoch = Math.floor(Date.now() / (1000 * 60 * 60));
    const mediaCount = 12 + ((seed + hoursSinceEpoch) % 6);
    const followersCount = 5000 + (seed % 50000) + hoursSinceEpoch * 3;

    return {
      ok: true,
      profile: {
        username,
        name: username
          .split(/[._]/)
          .filter(Boolean)
          .map((p) => p[0].toUpperCase() + p.slice(1))
          .join(" "),
        biography: `Mock bio for @${username} — generated by MOCK_META_API.`,
        website: `https://example.com/${username}`,
        profilePictureUrl: `https://picsum.photos/seed/${seed}/200/200`,
        followersCount,
        followsCount: 100 + (seed % 500),
        mediaCount,
        reelsCount: Math.floor(mediaCount / 3),
        hasStory: (seed % 2) === 0,
        storiesCount: (seed % 2) === 0 ? 1 + (seed % 4) : 0,
      },
      media: buildMockMedia(username, mediaCount),
    };
  }
}
