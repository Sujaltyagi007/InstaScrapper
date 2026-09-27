import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { getStorageOverview } from "@/lib/services/storage-manager.service";

// Registers any files the register doesn't know yet (sizes come from the provider).
export const maxDuration = 60;

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(await getStorageOverview(userId));
  } catch (err) {
    return jsonError(err);
  }
}
