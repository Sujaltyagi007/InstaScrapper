import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, jsonError, ApiError } from "@/lib/api-helpers";
import { bulkSetTargetsActive, bulkDeleteTargets } from "@/lib/services/target.service";

const bulkActionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(["pause", "resume", "delete"]),
});

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = await req.json();
    const parsed = bulkActionSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input.");
    }
    const { ids, action } = parsed.data;

    const { count, total } = action === "delete" ? await bulkDeleteTargets(userId, ids) : await bulkSetTargetsActive(userId, ids, action === "resume");

    if (count === 0) {
      throw new ApiError(404, "None of the selected targets could be updated.");
    }

    return NextResponse.json({ count, total });
  } catch (err) {
    return jsonError(err);
  }
}
