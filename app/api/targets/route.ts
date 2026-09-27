import { after, NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { createTargetSchema } from "@/lib/validation/target";
import {
  resolveTargetUsername,
  normalizeUsername,
  createTarget,
  listTargets,
  verifiedResolution,
} from "@/lib/services/target.service";
import { isMonitorable, eligibilityMessage } from "@/lib/meta/capability.service";
import { prisma } from "@/lib/prisma";
import { assertCanAddTarget } from "@/lib/services/quota.service";
import { checkNeedsSession, processTarget } from "@/lib/services/monitoring.service";

// The first check runs right after the response (see below).
export const maxDuration = 120;

export async function GET() {
  try {
    const userId = await requireUserId();
    const targets = await listTargets(userId);
    return NextResponse.json({ targets });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = await req.json();
    const parsed = createTargetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
    }

    // Fail fast before the slow Instagram lookup. createTarget() re-checks
    // under a lock, so this is only for a quick, friendly response.
    await assertCanAddTarget(userId);

    const normalized = normalizeUsername(parsed.data.username);
    const existing = await prisma.target.findUnique({
      where: { userId_normalizedUsername: { userId, normalizedUsername: normalized } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "You're already monitoring this account." }, { status: 409 });
    }

    // Reuse the preview's lookup when the browser hands back its signed result;
    // otherwise look the account up (logged out, never with the burner).
    const resolution =
      verifiedResolution(userId, parsed.data.username, parsed.data.resolutionToken) ??
      (await resolveTargetUsername(parsed.data.username, null, userId));
    if (!isMonitorable(resolution)) {
      return NextResponse.json(
        { error: eligibilityMessage(resolution), resolution },
        { status: 422 }
      );
    }

    const target = await createTarget({
      userId,
      username: parsed.data.username,
      resolution,
      engineType: parsed.data.engineType,
      triggerMode: parsed.data.triggerMode,
      watchNewMedia: parsed.data.watchNewMedia,
      watchProfile: parsed.data.watchProfile,
      watchFollowerCount: parsed.data.watchFollowerCount,
      watchFollowingCount: parsed.data.watchFollowingCount,
      watchStories: parsed.data.watchStories,
      watchReels: parsed.data.watchReels,
      watchFollowerChurn: parsed.data.watchFollowerChurn,
      watchCollabPosts: parsed.data.watchCollabPosts,
      jitterEnabled: parsed.data.jitterEnabled,
      humanSimEnabled: parsed.data.humanSimEnabled,
      restrictedHoursEnabled: parsed.data.restrictedHoursEnabled,
      restrictedHoursStart: parsed.data.restrictedHoursStart,
      restrictedHoursEnd: parsed.data.restrictedHoursEnd,
      instagramSessionId: parsed.data.instagramSessionId,
      followerThreshold: parsed.data.followerThreshold,
      intervalSeconds: parsed.data.intervalSeconds,
      notificationChannelIds: parsed.data.notificationChannelIds,
    });

    // Fill the new target's profile and posts now instead of at the next
    // scheduler pass, but only for logged-out checks: a burner check stays on
    // the paced scheduler so adding several accounts can't burst it.
    if (target.status === "ACTIVE" && !(await checkNeedsSession(target))) {
      after(() => processTarget(target.id).catch((err) => console.error("[targets] first check failed:", err)));
    }

    return NextResponse.json({ target }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
