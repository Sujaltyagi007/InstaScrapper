import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, jsonError, requireUserId } from "@/lib/api-helpers";
import { deleteUserFiles, listGroupFiles } from "@/lib/services/storage-manager.service";

export const maxDuration = 120;

// ?group=<key>&page=<n>: one page of a group's files.
export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const group = searchParams.get("group");
    if (!group) throw new ApiError(400, "Choose a group.");
    const page = Math.max(0, Number(searchParams.get("page") ?? 0) || 0);
    return NextResponse.json(await listGroupFiles(userId, group, page));
  } catch (err) {
    return jsonError(err);
  }
}

const deleteSchema = z.object({ fileIds: z.array(z.string().min(1)).min(1).max(500) });

// Deletes selected files (only the caller's own).
export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "Select files to delete.");
    return NextResponse.json(await deleteUserFiles(userId, parsed.data.fileIds));
  } catch (err) {
    return jsonError(err);
  }
}
