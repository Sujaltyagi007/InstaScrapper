import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, jsonError, ApiError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getProviderMode } from "@/lib/meta/provider-factory";
import { getActiveGraphAccount } from "@/lib/services/meta-connection.service";
import { publishToInstagram } from "@/lib/meta/graph-publish";

/**
 * Reposts a saved media item to the user's OWN Instagram account through the
 * official Graph API Content Publishing endpoints.
 *
 * ⚠️ Instagram fetches the media from a **public URL** — it does not accept raw
 * bytes. So the item must already be in our storage (or still have a reachable
 * source URL). That's why storage being configured is a hard requirement here,
 * unlike the old byte-upload path.
 *
 * ⚠️ Content rights are on you: posting media you don't own is a copyright/ToS
 * exposure on your real account no matter how sanctioned the transport is.
 * See docs/risk-model.md.
 */

// Reels are transcoded server-side by Instagram and we poll for it.
export const maxDuration = 180;

const schema = z.object({
  caption: z.string().max(2200).optional(),
});

/** A URL Meta's servers can actually fetch. Localhost/private URLs can't work. */
function publicUrlFor(media: {
  storageUrl: string | null;
  sourceMediaUrl: string | null;
  sourceVideoUrl: string | null;
  mediaUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
}, isVideo: boolean): string | null {
  const candidates = isVideo
    ? [media.storageUrl, media.sourceVideoUrl, media.videoUrl]
    : [media.storageUrl, media.sourceMediaUrl, media.mediaUrl, media.thumbnailUrl];
  for (const url of candidates) {
    if (url && /^https:\/\//i.test(url) && !/localhost|127\.0\.0\.1/i.test(url)) return url;
  }
  return null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input.");

    if (getProviderMode() !== "GRAPH") {
      throw new ApiError(
        400,
        "Reposting now requires the official Instagram API. Configure META_APP_ID/META_APP_SECRET and connect your account in Settings.",
        "GRAPH_MODE_REQUIRED",
      );
    }

    const account = await getActiveGraphAccount(userId);
    if (!account) {
      throw new ApiError(
        400,
        "Connect your Instagram professional account in Settings before posting.",
        "NO_META_CONNECTION",
      );
    }

    const media = await prisma.media.findFirst({ where: { id, target: { userId } } });
    if (!media) throw new ApiError(404, "Media not found.");

    const isVideo = media.mediaType === "VIDEO" || media.mediaType === "REEL" || Boolean(media.videoUrl);

    // Don't repost the same source media to the same account twice.
    const dupe = await prisma.repost.findFirst({
      where: { sourceMediaId: media.id, sessionId: account.igUserId, status: "POSTED" },
      select: { instagramMediaId: true },
    });
    if (dupe) {
      throw new ApiError(409, "This item was already posted to that account.", "REPOST_DUPLICATE", {
        instagramMediaId: dupe.instagramMediaId,
      });
    }

    const mediaUrl = publicUrlFor(media, isVideo);
    if (!mediaUrl) {
      throw new ApiError(
        502,
        isVideo
          ? "No public video URL available for this post. Instagram has to fetch the file itself, so the video must still be in storage or reachable at its source."
          : "No public image URL available for this post. Instagram has to fetch the file itself, so the image must still be in storage or reachable at its source.",
        "REPOST_NO_PUBLIC_URL",
      );
    }

    const caption = parsed.data.caption ?? media.caption ?? "";
    const repost = await prisma.repost.create({
      data: { userId, sourceMediaId: media.id, sessionId: account.igUserId, caption, status: "PENDING" },
    });

    const result = await publishToInstagram({
      account,
      kind: isVideo ? "REEL" : "IMAGE",
      mediaUrl,
      caption,
      coverUrl: isVideo ? (media.thumbnailUrl ?? undefined) : undefined,
    });

    await prisma.repost.update({
      where: { id: repost.id },
      data: {
        status: result.ok ? "POSTED" : "FAILED",
        instagramMediaId: result.ok ? result.instagramMediaId : null,
        error: result.ok ? null : result.errorMessage,
      },
    });

    if (!result.ok) {
      throw new ApiError(
        502,
        result.errorMessage ?? "Instagram rejected the post.",
        result.errorCode ?? "REPOST_FAILED",
      );
    }
    return NextResponse.json({ ok: true, instagramMediaId: result.instagramMediaId });
  } catch (err) {
    return jsonError(err);
  }
}
