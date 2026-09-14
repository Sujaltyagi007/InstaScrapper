import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { isMockMetaApi } from "@/lib/meta/provider-factory";

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
        status: true,
        scopes: true,
        expiresAt: true,
        lastVerifiedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ connection, mock: isMockMetaApi() });
  } catch (err) {
    return jsonError(err);
  }
}
