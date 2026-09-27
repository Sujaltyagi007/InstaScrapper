import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { listIdeas } from "@/lib/services/idea.service";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ ideas: await listIdeas(userId) });
  } catch (err) {
    return jsonError(err);
  }
}
