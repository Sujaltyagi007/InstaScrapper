import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { saveNicheSchema } from "@/lib/validation/niche";
import { getNiche, saveNiche } from "@/lib/services/niche.service";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(await getNiche(userId));
  } catch (err) {
    return jsonError(err);
  }
}

export async function PUT(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = saveNicheSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
    }
    const niche = await saveNiche(userId, parsed.data);
    return NextResponse.json({ niche });
  } catch (err) {
    return jsonError(err);
  }
}
