import { NextResponse } from "next/server";
import { requireCronAuth, jsonError } from "@/lib/api-helpers";
import { runDueTargetChecks } from "@/lib/services/monitoring.service";

// Wired to Vercel Cron (see vercel.json). Also callable manually with
// `Authorization: Bearer $CRON_SECRET` for local testing.
export async function GET(req: Request) {
  try {
    requireCronAuth(req);
    const result = await runDueTargetChecks(20);
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
