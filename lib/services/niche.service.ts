import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-helpers";
import { getProviderMode } from "@/lib/meta/provider-mode";
import { generateJson, isGeminiConfigured } from "@/lib/ai/gemini";
import { assertCanAddTarget } from "@/lib/services/quota.service";
import { eligibilityMessage, isMonitorable } from "@/lib/meta/capability.service";
import {
  createTarget,
  deleteTarget,
  normalizeUsername,
  resolveTargetUsername,
  validateUsernameFormat,
} from "@/lib/services/target.service";


/** Trend data only needs refreshing twice a day; the scheduler adds human-like jitter. */
const TREND_CHECK_INTERVAL_SECONDS = 12 * 60 * 60;

export async function getNiche(userId: string) {
  const niche = await prisma.niche.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      accounts: {
        orderBy: { createdAt: "asc" },
        include: {
          target: {
            select: {
              id: true,
              username: true,
              status: true,
              errorMessage: true,
              lastSuccessAt: true,
              monitor: { select: { purpose: true } },
              _count: { select: { media: true } },
            },
          },
        },
      },
    },
  });
  const [sessions, graphConnections, posts] = await Promise.all([
    prisma.instagramSession.count({ where: { userId, status: "ACTIVE" } }),
    prisma.metaConnection.count({ where: { userId, status: "ACTIVE" } }),
    niche
      ? prisma.media.findMany({
        where: { isStory: false, target: { nicheAccounts: { some: { nicheId: niche.id } } } },
        orderBy: { firstSeenAt: "desc" },
        take: 15,
        select: {
          id: true,
          permalink: true,
          mediaType: true,
          caption: true,
          timestamp: true,
          playCount: true,
          likeCount: true,
          commentCount: true,
          metricsUpdatedAt: true,
          target: { select: { username: true } },
        },
      })
      : Promise.resolve([]),
  ]);
  return {
    niche,
    hasActiveSession: sessions > 0,
    automaticMetricsAvailable: getProviderMode() === "GRAPH" && graphConnections > 0,
    posts,
  };
}

export async function saveNiche(
  userId: string,
  input: { name: string; description?: string | null; language?: string },
) {
  const existing = await prisma.niche.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  const data = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    language: input.language?.trim() || "en",
  };
  return existing
    ? prisma.niche.update({ where: { id: existing.id }, data })
    : prisma.niche.create({ data: { userId, ...data } });
}

async function requireNiche(userId: string) {
  const niche = await prisma.niche.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (!niche) throw new ApiError(400, "Set up your niche first.", "NICHE_REQUIRED");
  return niche;
}

export interface AccountSuggestion {
  username: string;
  reason: string;
}

/**
 * Gemini proposes accounts for the niche. These are NOT verified: a model can
 * name accounts that don't exist, so each is checked against Instagram when the
 * user adds it, rather than spending a profile request on every suggestion.
 */
export async function suggestNicheAccounts(userId: string): Promise<AccountSuggestion[]> {
  if (!isGeminiConfigured()) throw new ApiError(400, "GEMINI_API_KEY is not set on the server.", "GEMINI_NOT_CONFIGURED");
  const niche = await requireNiche(userId);
  const current = await prisma.nicheAccount.findMany({
    where: { nicheId: niche.id },
    select: { target: { select: { normalizedUsername: true } } },
  });
  const exclude = current.map((a) => a.target.normalizedUsername);

  const result = await generateJson<{ accounts: AccountSuggestion[] }>({
    prompt: [
      `Suggest 10 public Instagram accounts that post popular reels in this niche.`,
      `Niche: ${niche.name}`,
      niche.description ? `Details: ${niche.description}` : "",
      `Language/market: ${niche.language}`,
      `Prefer accounts whose reels regularly get high views and that make their own content (not repost pages).`,
      `Only include accounts you are confident exist. Give the exact handle without @.`,
      exclude.length ? `Do not include: ${exclude.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    schema: {
      type: "object",
      properties: {
        accounts: {
          type: "array",
          items: {
            type: "object",
            properties: { username: { type: "string" }, reason: { type: "string" } },
            required: ["username", "reason"],
          },
        },
      },
      required: ["accounts"],
    },
  });

  const seen = new Set(exclude);
  const suggestions: AccountSuggestion[] = [];
  for (const raw of result.accounts ?? []) {
    const username = normalizeUsername(raw.username ?? "");
    if (!validateUsernameFormat(username).valid || seen.has(username)) continue;
    seen.add(username);
    suggestions.push({ username, reason: (raw.reason ?? "").trim() });
  }
  return suggestions;
}

/**
 * Adds an account to the niche. Reuses an existing Target when the user already
 * monitors it (it keeps its own behaviour); otherwise creates a TREND target.
 * Either way it counts toward the user's account limit, like any target.
 */
export async function addNicheAccount(userId: string, rawUsername: string, source: "USER" | "SUGGESTED") {
  const niche = await requireNiche(userId);
  const format = validateUsernameFormat(rawUsername);
  if (!format.valid) throw new ApiError(400, format.reason ?? "Invalid username.");
  const normalized = normalizeUsername(rawUsername);

  let target = await prisma.target.findUnique({
    where: { userId_normalizedUsername: { userId, normalizedUsername: normalized } },
    select: { id: true },
  });

  if (!target) {
    await assertCanAddTarget(userId);
    // Logged out: looking up a public account never needs (or risks) the burner.
    const resolution = await resolveTargetUsername(normalized, null, userId);
    if (!isMonitorable(resolution)) {
      throw new ApiError(422, `@${normalized}: ${eligibilityMessage(resolution)}`, "ACCOUNT_NOT_MONITORABLE");
    }
    target = await createTarget({
      userId,
      username: normalized,
      resolution,
      purpose: "TREND",
      triggerMode: "NEW_POSTS_ONLY",
      watchNewMedia: true,
      watchProfile: false,
      watchFollowerCount: false,
      watchFollowingCount: false,
      watchStories: false,
      watchReels: true,
      watchFollowerChurn: false,
      watchCollabPosts: false,
      intervalSeconds: TREND_CHECK_INTERVAL_SECONDS,
      notificationChannelIds: [],
    });
  }

  return prisma.nicheAccount.upsert({
    where: { nicheId_targetId: { nicheId: niche.id, targetId: target.id } },
    create: { nicheId: niche.id, targetId: target.id, source },
    update: {},
  });
}

/** Removes the account from the niche; deletes the target too if it only existed for trends. */
export async function removeNicheAccount(userId: string, nicheAccountId: string) {
  const link = await prisma.nicheAccount.findFirst({
    where: { id: nicheAccountId, niche: { userId } },
    include: { target: { select: { id: true, monitor: { select: { purpose: true } } } } },
  });
  if (!link) throw new ApiError(404, "Niche account not found.");

  if (link.target.monitor?.purpose === "TREND") {
    // A trend-only target was created just for the niche; its files (profile
    // pictures) have no other use, so they go with it.
    await deleteTarget(userId, link.target.id, { deleteFiles: true });
  } else {
    await prisma.nicheAccount.delete({ where: { id: link.id } });
  }
}
