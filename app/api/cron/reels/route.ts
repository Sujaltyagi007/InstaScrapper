import { NextResponse } from "next/server";
import { jsonError, requireCronAuth } from "@/lib/api-helpers";
import { advanceReelProjects, cleanupPostedRenders, DEFAULT_BUDGET_MS } from "@/lib/services/reel-pipeline.service";
import { sendDueReels } from "@/lib/services/reel-delivery.service";

// Stages call Gemini and ffmpeg; rendering can take minutes on one vCPU. The
// runner stops starting new stages well before the 300s limit.
export const maxDuration = 300;

// Called by the external scheduler (cron-job.org) every 5 minutes with
// `Authorization: Bearer $CRON_SECRET`. Pushes due reels to the phone first
// (quick, and time-sensitive), then advances reel projects.
export async function GET(req: Request) {
  try {
    requireCronAuth(req);
    const delivery = await sendDueReels();
    const pipeline = await advanceReelProjects({ budgetMs: DEFAULT_BUDGET_MS });
    const cleanedRenders = await cleanupPostedRenders();
    return NextResponse.json({ delivery, ...pipeline, cleanedRenders });
  } catch (err) {
    return jsonError(err);
  }
}
