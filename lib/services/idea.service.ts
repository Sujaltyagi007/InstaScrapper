import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-helpers";
import { generateJson, isGeminiConfigured } from "@/lib/ai/gemini";
import { getTrendCandidates, type TrendCandidate } from "@/lib/services/trend.service";

/** How many top trends Gemini sees per generation, and how many ideas it may return. */
const CANDIDATES_PER_RUN = 15;
const MAX_IDEAS_PER_RUN = 5;
/** A trend already turned into an idea isn't offered again for this long. */
const SOURCE_REUSE_DAYS = 14;

export type IdeaStatus = "SUGGESTED" | "APPROVED" | "DISMISSED";

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function describe(c: TrendCandidate, index: number): string {
  const days = c.ageHours >= 48 ? `${Math.round(c.ageHours / 24)} days old` : `${Math.round(c.ageHours)}h old`;
  const audio = c.audioTitle
    ? `audio: "${c.audioTitle}"${c.audioIsOriginal ? " (creator's own sound)" : " (licensed music)"}`
    : "audio: unknown";
  const caption = (c.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || "(no caption)";
  return `[${index}] @${c.username} · ${c.mediaType.toLowerCase()} · ${compact(c.value)} ${c.kind} (${c.ratio.toFixed(1)}× their usual) · ${days} · ${audio}\n    caption: ${caption}`;
}

/** Explains why no trends were found, so the UI can say what to do next. */
async function noTrendsError(userId: string): Promise<ApiError> {
  const accounts = await prisma.nicheAccount.count({ where: { niche: { userId } } });
  if (accounts === 0) {
    return new ApiError(409, "Add a few accounts to learn from first.", "NO_NICHE_ACCOUNTS");
  }
  const withMetrics = await prisma.media.count({
    where: { target: { nicheAccounts: { some: { niche: { userId } } } }, metricsUpdatedAt: { not: null } },
  });
  if (withMetrics === 0) {
    return new ApiError(409,
      "No metrics yet. Automatic counts require an authorized Meta Graph connection and public Business/Creator target accounts. Otherwise, enter views, likes, comments and post dates in Studio.",
      "NO_TREND_DATA",
    );
  }
  return new ApiError(409,
    "No recent posts are beating their usual numbers yet. Trends need at least three comparable metric samples and one post at 1.5× its baseline within 30 days. Add metrics to more niche posts or try again after a high-performing post.",
    "NO_TRENDS",
  );
}

export async function generateIdeas(userId: string) {
  if (!isGeminiConfigured()) throw new ApiError(400, "GEMINI_API_KEY is not set on the server.", "GEMINI_NOT_CONFIGURED");
  const niche = await prisma.niche.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (!niche) throw new ApiError(400, "Set up your niche first.", "NICHE_REQUIRED");

  const recentIdeas = await prisma.reelIdea.findMany({
    where: { nicheId: niche.id, createdAt: { gte: new Date(Date.now() - SOURCE_REUSE_DAYS * 86_400_000) } },
    select: { sourceMediaIds: true },
  });
  const used = new Set(recentIdeas.flatMap((i) => i.sourceMediaIds));
  const rankedCandidates = await getTrendCandidates(userId);
  const candidates = rankedCandidates.filter((candidate) => !used.has(candidate.id)).slice(0, CANDIDATES_PER_RUN);
  if (candidates.length === 0) {
    if (rankedCandidates.length > 0) {
      throw new ApiError(
        409,
        `All ${rankedCandidates.length} posts currently beating their usual numbers were already used in ideas within the last ${SOURCE_REUSE_DAYS} days.`,
        "TRENDS_ALREADY_USED",
      );
    }
    throw await noTrendsError(userId);
  }

  const result = await generateJson<{
    ideas: { title: string; angle: string; hook: string; whyTrending: string; sources: number[] }[];
  }>({
    prompt: [
      `You plan Instagram reels for a creator in this niche: ${niche.name}.`,
      niche.description ? `About the account: ${niche.description}` : "",
      `Language for all text: ${niche.language}.`,
      ``,
      `These reels from accounts in the niche are currently performing far above their usual numbers:`,
      candidates.map(describe).join("\n"),
      ``,
      `Group them by the underlying topic or format people are responding to, and propose up to ${MAX_IDEAS_PER_RUN} reel ideas.`,
      `Rules:`,
      `- Each idea must be ORIGINAL: a fresh angle, new facts or a new take on the trending topic. Never copy a source reel's script, jokes or structure beat for beat.`,
      `- It will be made with licensed stock footage, an AI voiceover and on-screen captions, 20-45 seconds long. Don't propose ideas that need specific people, celebrities, brands, movie/TV/sports footage or the creator's face.`,
      `- "hook" is the first spoken line (under 12 words) that stops the scroll.`,
      `- "whyTrending" explains in one or two sentences what the numbers show and why the audience responds to it. Don't mention the [numbers]; the source reels are shown next to the idea.`,
      `- "sources" lists the [numbers] of the reels the idea is based on.`,
    ]
      .filter((line) => line !== "")
      .join("\n"),
    schema: {
      type: "object",
      properties: {
        ideas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              angle: { type: "string" },
              hook: { type: "string" },
              whyTrending: { type: "string" },
              sources: { type: "array", items: { type: "integer" } },
            },
            required: ["title", "angle", "hook", "whyTrending", "sources"],
          },
        },
      },
      required: ["ideas"],
    },
  });

  const rows = [];
  for (const idea of (result.ideas ?? []).slice(0, MAX_IDEAS_PER_RUN)) {
    const sources = [...new Set(idea.sources ?? [])]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length)
      .map((i) => candidates[i]);
    // An idea with no valid evidence isn't a trend idea; drop it rather than guess.
    if (sources.length === 0 || !idea.title?.trim() || !idea.hook?.trim()) continue;
    rows.push({
      nicheId: niche.id,
      title: idea.title.trim(),
      angle: (idea.angle ?? "").trim(),
      hook: idea.hook.trim(),
      // The model sometimes cites the prompt's "[0]" numbering anyway; it means nothing to the user.
      whyTrending: (idea.whyTrending ?? "").replace(/\s*\(?\[\d+(?:,\s*\d+)*\]\)?/g, "").trim(),
      score: Math.max(...sources.map((s) => s.score)),
      sourceMediaIds: sources.map((s) => s.id),
    });
  }
  if (rows.length === 0) throw new ApiError(502, "Gemini didn't return any usable ideas. Try again.", "NO_IDEAS");

  await prisma.reelIdea.createMany({ data: rows });
  return { created: rows.length, candidatesConsidered: candidates.length };
}

export interface IdeaSource {
  id: string;
  username: string;
  permalink: string | null;
  mediaType: string;
  playCount: number | null;
  likeCount: number | null;
  timestamp: Date | null;
}

/** Suggested + approved ideas for the user's niche, best first, with their evidence reels. */
export async function listIdeas(userId: string) {
  const ideas = await prisma.reelIdea.findMany({
    where: { niche: { userId }, status: { in: ["SUGGESTED", "APPROVED"] } },
    orderBy: [{ status: "asc" }, { score: "desc" }, { createdAt: "desc" }],
    take: 30,
  });
  const sourceIds = [...new Set(ideas.flatMap((i) => i.sourceMediaIds))];
  const media = sourceIds.length
    ? await prisma.media.findMany({
      where: { id: { in: sourceIds } },
      select: {
        id: true,
        permalink: true,
        mediaType: true,
        playCount: true,
        likeCount: true,
        timestamp: true,
        target: { select: { username: true } },
      },
    })
    : [];
  const byId = new Map<string, IdeaSource>(
    media.map((m) => [m.id, { ...m, username: m.target.username }]),
  );
  return ideas.map((idea) => ({
    ...idea,
    // Sources can vanish if a niche account was removed; the idea itself stays.
    sources: idea.sourceMediaIds.map((id) => byId.get(id)).filter((s): s is IdeaSource => Boolean(s)),
  }));
}

export async function setIdeaStatus(userId: string, id: string, status: IdeaStatus) {
  if (status !== "APPROVED") {
    const project = await prisma.reelProject.findFirst({ where: { ideaId: id, userId }, select: { id: true } });
    if (project) throw new ApiError(409, "This idea already has a reel. Delete the reel first.");
  }
  const { count } = await prisma.reelIdea.updateMany({ where: { id, niche: { userId } }, data: { status } });
  if (count === 0) throw new ApiError(404, "Idea not found.");
}
