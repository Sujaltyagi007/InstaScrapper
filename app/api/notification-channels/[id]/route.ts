import { NextResponse } from "next/server";
import { requireUserId, jsonError, ApiError } from "@/lib/api-helpers";
import { updateNotificationChannelSchema } from "@/lib/validation/notification";
import { buildEncryptedConfig } from "@/lib/services/notification.service";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const existing = await prisma.notificationChannel.findFirst({ where: { id, userId } });
    if (!existing) throw new ApiError(404, "Notification channel not found.");

    const body = await req.json();
    const parsed = updateNotificationChannelSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.eventTypeFilter !== undefined) data.eventTypeFilter = parsed.data.eventTypeFilter;
    if (parsed.data.cooldownSeconds !== undefined) data.cooldownSeconds = parsed.data.cooldownSeconds;
    if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;
    if (parsed.data.config !== undefined) {
      const { provider, ...rawConfig } = parsed.data.config;
      const { encryptedConfig, encryptedConfigIv } = buildEncryptedConfig(provider, rawConfig);
      data.provider = provider;
      data.encryptedConfig = encryptedConfig;
      data.encryptedConfigIv = encryptedConfigIv;
    }

    const channel = await prisma.notificationChannel.update({
      where: { id },
      data,
      select: { id: true, name: true, provider: true, eventTypeFilter: true, cooldownSeconds: true, enabled: true },
    });

    return NextResponse.json({ channel });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const existing = await prisma.notificationChannel.findFirst({ where: { id, userId } });
    if (!existing) throw new ApiError(404, "Notification channel not found.");
    await prisma.notificationChannel.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
