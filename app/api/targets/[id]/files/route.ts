import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { countTargetFiles } from "@/lib/services/storage-manager.service";

// How many stored files an account has, for the delete dialog.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const owned = await prisma.target.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new NotFoundError("Target not found.");
    return NextResponse.json(await countTargetFiles(userId, id));
  } catch (err) {
    return jsonError(err);
  }
}
