import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { cleanupProfilePictures } from "@/lib/services/storage-manager.service";

export const maxDuration = 300;

// Deletes old profile-picture copies, keeping each account's current picture.
export async function POST() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(await cleanupProfilePictures(userId));
  } catch (err) {
    return jsonError(err);
  }
}
