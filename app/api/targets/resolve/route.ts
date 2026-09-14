import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { resolveTargetSchema } from "@/lib/validation/target";
import { resolveTargetUsername, normalizeUsername } from "@/lib/services/target.service";
import { eligibilityMessage } from "@/lib/meta/capability.service";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = await req.json();
    const parsed = resolveTargetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
    }

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

    const resolution = await resolveTargetUsername(parsed.data.username);
    return NextResponse.json({ resolution, message: eligibilityMessage(resolution) });
  } catch (err) {
    return jsonError(err);
  }
}
