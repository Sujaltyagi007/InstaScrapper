import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { createNotificationChannelSchema } from "@/lib/validation/notification";
import { buildEncryptedConfig } from "@/lib/services/notification.service";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const userId = await requireUserId();
    const channels = await prisma.notificationChannel.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        provider: true,
        eventTypeFilter: true,
        cooldownSeconds: true,
        enabled: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ channels });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = await req.json();
    const parsed = createNotificationChannelSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
    }

    const { provider, ...rawConfig } = parsed.data.config;
    const { encryptedConfig, encryptedConfigIv } = buildEncryptedConfig(provider, rawConfig);

    const channel = await prisma.notificationChannel.create({
      data: {
        userId,
        name: parsed.data.name,
        provider,
        encryptedConfig,
        encryptedConfigIv,
        eventTypeFilter: parsed.data.eventTypeFilter,
        cooldownSeconds: parsed.data.cooldownSeconds,
        enabled: parsed.data.enabled,
      },
      select: { id: true, name: true, provider: true, eventTypeFilter: true, cooldownSeconds: true, enabled: true },
    });

    return NextResponse.json({ channel }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
