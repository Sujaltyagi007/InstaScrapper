import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { updateSettingsSchema } from "@/lib/validation/settings";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const userId = await requireUserId();
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, timezone: true, retentionDays: true },
    });
    return NextResponse.json({ user });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = await requireUserId();
    const body = await req.json();
    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
    }
    const user = await prisma.user.update({
      where: { id: userId },
      data: parsed.data,
      select: { id: true, email: true, name: true, timezone: true, retentionDays: true },
    });
    return NextResponse.json({ user });
  } catch (err) {
    return jsonError(err);
  }
}
