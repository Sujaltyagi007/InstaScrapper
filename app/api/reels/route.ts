import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { listReelProjects } from "@/lib/services/reel-pipeline.service";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ reels: await listReelProjects(userId) });
  } catch (err) {
    return jsonError(err);
  }
}
