import { NextResponse } from "next/server";
import { requireCronAuth, jsonError } from "@/lib/api-helpers";
import { runDueTargetChecks, DEFAULT_RUN_BUDGET_MS } from "@/lib/services/monitoring.service";

// Vercel Hobby caps functions at 60s. The runner stops starting new checks
// well before that (DEFAULT_RUN_BUDGET_MS = 45s) so it can finish cleanly.
export const maxDuration = 60;

// Called by the external scheduler (cron-job.org / GitHub Actions) every few
// minutes, and by Vercel Cron once a day as a fallback. Each call does a small,
// human-paced slice of work; frequent calls, not big batches, keep up with the
// target list. Requires `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: Request) {
  try {
    requireCronAuth(req);
    const result = await runDueTargetChecks({ budgetMs: DEFAULT_RUN_BUDGET_MS });
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
