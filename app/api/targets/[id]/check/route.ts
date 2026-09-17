import { NextResponse } from "next/server";
import { requireUserId, jsonError, ApiError } from "@/lib/api-helpers";
import { getTargetDetail } from "@/lib/services/target.service";
import { processTarget } from "@/lib/services/monitoring.service";

// Runs a check for one target on demand, so a freshly added target (or one
// whose next scheduled run is far off) can be populated without waiting for
// the cron interval. Ownership is verified before running.
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;

    const target = await getTargetDetail(userId, id);
    if (!target) throw new ApiError(404, "Target not found.");

    const result = await processTarget(id);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return jsonError(err);
  }
}
