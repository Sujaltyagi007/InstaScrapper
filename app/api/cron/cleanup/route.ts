import { NextResponse } from "next/server";
import { requireCronAuth, jsonError } from "@/lib/api-helpers";
import { runRetentionCleanup } from "@/lib/services/retention.service";

export async function GET(req: Request) {
  try {
    requireCronAuth(req);
    const result = await runRetentionCleanup();
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
