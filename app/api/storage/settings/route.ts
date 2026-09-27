import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, jsonError, requireUserId } from "@/lib/api-helpers";
import { setMediaKeepHours } from "@/lib/services/storage-manager.service";

const schema = z.object({ mediaKeepHours: z.number().int().positive().nullable() });

// How long full-size scraped media is kept (null = until deleted by hand).
export async function PUT(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "Invalid setting.");
    await setMediaKeepHours(userId, parsed.data.mediaKeepHours);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
