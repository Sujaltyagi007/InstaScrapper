import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { decryptSecret } from "@/lib/crypto";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { resolveTargetSchema } from "@/lib/validation/target";
import { eligibilityMessage } from "@/lib/meta/capability.service";
import { resolveTargetUsername, normalizeUsername, signResolution } from "@/lib/services/target.service";
import { assertCanAddTarget } from "@/lib/services/quota.service";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = await req.json();
    const parsed = resolveTargetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
    }

    // Block at the preview step too, so a user at their limit learns it
    // before waiting on an Instagram lookup they can't act on.
    await assertCanAddTarget(userId);

    const existing = await prisma.target.findUnique({
      where: {
        userId_normalizedUsername: { userId, normalizedUsername: normalizeUsername(parsed.data.username) },
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "You're already monitoring this account.", existingTargetId: existing.id },
        { status: 409 }
      );
    }

    // Always logged out: a public profile lookup needs no account, and keeping
    // the burner out of it means adding targets never adds risk to it.
    const resolution = await resolveTargetUsername(parsed.data.username, null, userId);
    return NextResponse.json({
      resolution,
      message: eligibilityMessage(resolution),
      resolutionToken: signResolution(userId, resolution),
    });
  } catch (err) {
    return jsonError(err);
  }
}
