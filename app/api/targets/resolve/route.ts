import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { decryptSecret } from "@/lib/crypto";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { resolveTargetSchema } from "@/lib/validation/target";
import { eligibilityMessage } from "@/lib/meta/capability.service";
import { resolveTargetUsername, normalizeUsername } from "@/lib/services/target.service";
import { peekSession } from "@/lib/meta/session-pool";

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

    const picked = await peekSession(userId, { pinnedSessionId: null });
    let sessionConfig = picked?.config ?? null;
    let sessionDiag: Record<string, unknown> = { sessionFound: !!picked };

    if (picked) {
      sessionDiag.sessionId = picked.id;
      sessionDiag.sessionUsername = sessionConfig?.username;
      sessionDiag.decryptionOk = true;
    }

    const resolution = await resolveTargetUsername(parsed.data.username, sessionConfig);
    return NextResponse.json({ resolution, message: eligibilityMessage(resolution), _sessionDiag: sessionDiag });
  } catch (err) {
    return jsonError(err);
  }
}
