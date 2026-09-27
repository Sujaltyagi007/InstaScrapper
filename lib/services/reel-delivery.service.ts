import { prisma } from "@/lib/prisma";
import { decryptJson } from "@/lib/crypto";
import { ApiError } from "@/lib/api-helpers";
import { publicDownloadUrl } from "@/lib/storage";
import { assertPublicHttpUrl } from "@/lib/security/ssrf";
import { pickSendTime } from "@/lib/scheduling/post-time";
import { safeTimeZone } from "@/lib/scheduling/time-windows";
import { dispatchToProvider } from "@/lib/notifications/dispatch";
import type { ChannelConfig, NtfyConfig } from "@/lib/notifications/types";

/** A failed push is retried this much later. */
const SEND_RETRY_MS = 10 * 60_000;

function appBaseUrl(): string {
  return (process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function reviewPageUrl(projectId: string): string {
  return `${appBaseUrl()}/studio/reels/${projectId}`;
}

/** The text the user pastes into Instagram. */
export function fullCaption(caption: string | null, hashtags: string[]): string {
  return [caption ?? "", hashtags.join(" ")].filter(Boolean).join("\n\n");
}

async function sendNtfyReel(config: NtfyConfig, msg: { title: string; message: string; click: string; attach: string | null }): Promise<void> {
  const server = config.serverUrl.replace(/\/+$/, "");
  await assertPublicHttpUrl(server);
  const res = await fetch(server, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {}),
    },
    body: JSON.stringify({
      topic: config.topic,
      title: msg.title,
      message: msg.message,
      tags: ["clapper"],
      click: msg.click,
      ...(msg.attach ? { attach: msg.attach, filename: "reel.mp4" } : {}),
      actions: [
        ...(msg.attach ? [{ action: "view", label: "Download video", url: msg.attach }] : []),
        { action: "view", label: "Open reel page", url: msg.click },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ntfy responded ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

async function deliver(projectId: string): Promise<void> {
  const project = await prisma.reelProject.findUnique({
    where: { id: projectId },
    include: { idea: { select: { title: true } } },
  });
  if (!project?.renderFileId) throw new Error("The reel has no video.");
  const channels = await prisma.notificationChannel.findMany({ where: { userId: project.userId, enabled: true } });
  if (channels.length === 0) throw new Error("No enabled notification channel. Add an ntfy channel in Notifications.");

  const click = reviewPageUrl(project.id);
  const attach = publicDownloadUrl(project.renderFileId) ?? project.renderUrl;
  const caption = fullCaption(project.caption, project.hashtags);
  const title = `Reel ready to post: ${project.idea.title}`;

  let sent = 0;
  const failures: string[] = [];
  for (const channel of channels) {
    try {
      const config = decryptJson<ChannelConfig>({ ciphertext: channel.encryptedConfig, iv: channel.encryptedConfigIv });
      if (channel.provider === "NTFY") {
        await sendNtfyReel(config as NtfyConfig, { title, message: caption, click, attach });
      } else {
        await dispatchToProvider(
          channel.provider,
          config,
          {
            title,
            // A push is a short preview; the full caption is one tap away on the review page.
            body: channel.provider === "WEBPUSH" ? "Your reel is ready. Tap to review and post it." : `${caption}\n\nVideo and caption: ${click}`,
            url: click,
            eventType: "REEL_READY",
            targetUsername: "studio",
            appPath: `/studio/reels/${project.id}`,
            tag: `reel:${project.id}`,
          },
          { userId: project.userId },
        );
      }
      sent += 1;
    } catch (err) {
      failures.push(`${channel.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (sent === 0) throw new Error(`Couldn't send to any channel. ${failures.join("; ")}`.slice(0, 500));
}

async function readyProject(userId: string, id: string) {
  const project = await prisma.reelProject.findFirst({ where: { id, userId } });
  if (!project) throw new ApiError(404, "Reel not found.");
  if (project.stage !== "READY" || !project.renderFileId) throw new ApiError(409, "The reel isn't finished yet.");
  return project;
}

async function assertHasChannel(userId: string) {
  const count = await prisma.notificationChannel.count({ where: { userId, enabled: true } });
  if (count === 0) {
    throw new ApiError(
      409,
      "Add an ntfy channel in Notifications first, so the reel can reach your phone.",
      "NO_PHONE_CHANNEL",
    );
  }
}

/** Sends right away. */
export async function sendReelNow(userId: string, id: string): Promise<void> {
  await readyProject(userId, id);
  await assertHasChannel(userId);
  try {
    await deliver(id);
  } catch (err) {
    throw new ApiError(502, err instanceof Error ? err.message : "Sending failed.");
  }
  await prisma.reelProject.update({ where: { id }, data: { sentAt: new Date(), scheduledFor: null, error: null } });
}

/** Schedules the push for a good posting time (see lib/scheduling/post-time.ts). */
export async function scheduleReelSend(userId: string, id: string): Promise<Date> {
  await readyProject(userId, id);
  await assertHasChannel(userId);
  const [user, others] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true, sleepEnabled: true, sleepStartHour: true, sleepEndHour: true },
    }),
    prisma.reelProject.findMany({
      where: {
        userId,
        id: { not: id },
        OR: [{ scheduledFor: { not: null }, sentAt: null }, { sentAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }],
      },
      select: { scheduledFor: true, sentAt: true },
    }),
  ]);
  const taken = others.map((o) => o.sentAt ?? o.scheduledFor).filter((d): d is Date => d !== null);
  const when = pickSendTime(new Date(), {
    timeZone: safeTimeZone(user.timezone),
    sleep: { enabled: user.sleepEnabled, startHour: user.sleepStartHour, endHour: user.sleepEndHour },
    taken,
  });
  await prisma.reelProject.update({ where: { id }, data: { scheduledFor: when, sentAt: null, error: null } });
  return when;
}

export async function cancelReelSend(userId: string, id: string): Promise<void> {
  const { count } = await prisma.reelProject.updateMany({
    where: { id, userId, sentAt: null },
    data: { scheduledFor: null },
  });
  if (count === 0) throw new ApiError(404, "Nothing scheduled for this reel.");
}

/** Sends every reel whose scheduled time has come. Called by /api/cron/reels. */
export async function sendDueReels(): Promise<{ sent: number; failed: number }> {
  const due = await prisma.reelProject.findMany({
    where: { stage: "READY", sentAt: null, scheduledFor: { lte: new Date() } },
    select: { id: true },
    take: 10,
  });
  let sent = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      await deliver(id);
      await prisma.reelProject.update({ where: { id }, data: { sentAt: new Date(), error: null } });
      sent += 1;
    } catch (err) {
      failed += 1;
      await prisma.reelProject.update({
        where: { id },
        data: {
          error: `Sending to your phone failed, retrying: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500),
          scheduledFor: new Date(Date.now() + SEND_RETRY_MS),
        },
      });
    }
  }
  return { sent, failed };
}
