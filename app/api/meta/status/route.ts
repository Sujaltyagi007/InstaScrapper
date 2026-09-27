import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getProviderMode, isMockMetaApi } from "@/lib/meta/provider-factory";

export async function GET() {
  try {
    const userId = await requireUserId();
    const connection = await prisma.metaConnection.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        provider: true,
        accountType: true,
        igUsername: true,
        externalUserId: true,
        status: true,
        scopes: true,
        expiresAt: true,
        lastVerifiedAt: true,
        createdAt: true,
      },
    });

    const mode = getProviderMode();
    return NextResponse.json({
      connection,
      mock: isMockMetaApi(),
      mode,
      // Whether the server actually has a Meta app configured — without it the
      // Connect button can't work, so the UI should say so instead of failing.
      configured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
    });
  } catch (err) {
    return jsonError(err);
  }
}
