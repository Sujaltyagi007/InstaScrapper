import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { createTargetSchema } from "@/lib/validation/target";
import {
  resolveTargetUsername,
  normalizeUsername,
  createTarget,
  listTargets,
} from "@/lib/services/target.service";
import { isMonitorable, eligibilityMessage } from "@/lib/meta/capability.service";
import { prisma } from "@/lib/prisma";

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

    const normalized = normalizeUsername(parsed.data.username);
    const existing = await prisma.target.findUnique({
      where: { userId_normalizedUsername: { userId, normalizedUsername: normalized } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "You're already monitoring this account." }, { status: 409 });
    }

    const resolution = await resolveTargetUsername(parsed.data.username);
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

    return NextResponse.json({ target }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
