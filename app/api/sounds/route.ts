import { NextResponse } from "next/server";
import { ApiError, jsonError, requireUserId } from "@/lib/api-helpers";
import { downloadSoundUrl, importSound, listSounds, type SoundKind } from "@/lib/services/sound.service";

// Transcoding plus a Gemini tagging call.
export const maxDuration = 120;

/** Vercel rejects request bodies over 4.5 MB; bigger files must come in by link. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ sounds: await listSounds(userId) });
  } catch (err) {
    return jsonError(err);
  }
}

// multipart/form-data: kind (MUSIC | SFX), and either `file` or `url`; optional title, licenseUrl.
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const form = await req.formData().catch(() => {
      throw new ApiError(400, "Send the sound as a form upload.");
    });
    const kind = String(form.get("kind") ?? "");
    if (kind !== "MUSIC" && kind !== "SFX") throw new ApiError(400, "Choose music or sound effect.");
    const title = String(form.get("title") ?? "").slice(0, 120) || undefined;
    const licenseUrl = String(form.get("licenseUrl") ?? "").slice(0, 500) || undefined;
    const file = form.get("file");
    const url = String(form.get("url") ?? "").trim();

    let bytes: Buffer;
    let fileName: string;
    let source: string;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "Files over 4 MB have to be added by link.");
      bytes = Buffer.from(await file.arrayBuffer());
      fileName = file.name;
      source = "upload";
    } else if (url) {
      bytes = await downloadSoundUrl(url);
      const parsed = new URL(url);
      fileName = decodeURIComponent(parsed.searchParams.get("filename") ?? parsed.pathname.split("/").pop() ?? "sound");
      source = parsed.hostname;
    } else {
      throw new ApiError(400, "Add a file or a link.");
    }

    const result = await importSound(userId, { kind: kind as SoundKind, bytes, fileName, title, licenseUrl, source });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
