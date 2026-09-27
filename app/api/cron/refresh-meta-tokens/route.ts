import { NextResponse } from "next/server";
import { requireCronAuth, jsonError } from "@/lib/api-helpers";
import { refreshDueMetaTokens } from "@/lib/services/meta-connection.service";
import { refreshDueIgTokens } from "@/lib/services/ig-account.service";

/**
 * Refreshes long-lived tokens (~60 days) for both Facebook Login connections and
 * Instagram Login posting accounts, before they expire. Waiting for a 401 means
 * checks and posts are already failing by the time anyone notices.
 */
export async function GET(req: Request) {
  try {
    requireCronAuth(req);
    const [meta, instagram] = await Promise.all([refreshDueMetaTokens(), refreshDueIgTokens()]);
    return NextResponse.json({ meta, instagram });
  } catch (err) {
    return jsonError(err);
  }
}
