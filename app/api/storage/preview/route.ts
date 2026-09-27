import { ApiError, jsonError, requireUserId } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { downloadStoredObject } from "@/lib/storage";

/** Vercel caps a function response at 4.5 MB; bigger files open via their own link instead. */
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

// ?fileId=…: serves one of the caller's own files for the Storage page preview.
// Works even when the bucket isn't publicly readable, since it reads with the API key.
export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    const fileId = new URL(req.url).searchParams.get("fileId");
    if (!fileId) throw new ApiError(400, "Missing file.");
    const file = await prisma.storedFile.findFirst({
      where: { userId, fileId },
      select: { contentType: true, sizeBytes: true },
    });
    if (!file) throw new ApiError(404, "File not found.");
    if ((file.sizeBytes ?? 0) > MAX_PREVIEW_BYTES) throw new ApiError(413, "Too large to preview here.");
    const bytes = await downloadStoredObject(fileId);
    if (!bytes) throw new ApiError(404, "File not found in storage.");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.contentType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
