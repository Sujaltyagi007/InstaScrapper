import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, jsonError, requireUserId } from "@/lib/api-helpers";
import { deleteGroupFiles } from "@/lib/services/storage-manager.service";

export const maxDuration = 300;

const schema = z.object({
  group: z.string().min(1).max(200),
  kinds: z.array(z.enum(["MEDIA", "THUMBNAIL", "STORY", "PROFILE_PIC", "REEL", "SOUND", "OTHER"])).optional(),
});

// Deletes every file in a group, or only some kinds (e.g. full-size media only).
export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "Choose a group.");
    return NextResponse.json(await deleteGroupFiles(userId, parsed.data.group, parsed.data.kinds));
  } catch (err) {
    return jsonError(err);
  }
}
