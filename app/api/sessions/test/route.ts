import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { decryptJson } from "@/lib/crypto";
import { stealthTestSession } from "@/lib/meta/stealth-engine-bridge";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = await req.json();
    const { id } = body;

    const session = await prisma.instagramSession.findFirst({
      where: { id, userId },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const cookies = decryptJson<Record<string, string>>({
      ciphertext: session.encryptedCookies,
      iv: session.encryptedCookiesIv,
    });

    const testRes = await stealthTestSession({
      cookies,
      proxyUrl: session.proxyUrl,
      userAgent: session.userAgent,
      impersonateTarget: session.impersonateTarget,
    });

    const newStatus = testRes.ok
      ? "ACTIVE"
      : testRes.flagged
      ? "FLAGGED"
      : "CHECKPOINT_REQUIRED";

    await prisma.instagramSession.update({
      where: { id: session.id },
      data: {
        status: newStatus,
        lastTestedAt: new Date(),
        lastSuccessAt: testRes.ok ? new Date() : session.lastSuccessAt,
        lastErrorMessage: testRes.ok ? null : testRes.message,
      },
    });

    return NextResponse.json({
      ok: testRes.ok,
      status: newStatus,
      message: testRes.message,
      flagged: testRes.flagged,
    });
  } catch (err) {
    return jsonError(err);
  }
}
