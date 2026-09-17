import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, jsonError, ApiError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/access/permissions";
import { getTargetQuota, updateTargetLimit } from "@/lib/services/quota.service";

// Bounds are enforced by the role policy inside updateTargetLimit; this only
// rejects obviously malformed input.
const updateSchema = z.object({ maxTargets: z.number().int() });

/** Loads the signed-in user as an access-control actor. */
async function currentActor() {
  const userId = await requireUserId();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, role: true } });
  return user;
}

export async function GET() {
  try {
    const actor = await currentActor();
    if (!can(actor, "targetLimit.read", actor.id)) throw new ApiError(403, "Forbidden.");
    return NextResponse.json({ quota: await getTargetQuota(actor.id) });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const actor = await currentActor();
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) throw new ApiError(400, "maxTargets must be a whole number.");
    const quota = await updateTargetLimit(actor, actor.id, parsed.data.maxTargets);
    return NextResponse.json({ quota });
  } catch (err) {
    return jsonError(err);
  }
}
