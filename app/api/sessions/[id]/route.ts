import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUserId();
    const { id } = await params;

    await prisma.instagramSession.deleteMany({
      where: { id, userId },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
