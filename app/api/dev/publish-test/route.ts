import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, jsonError, requireCronAuth } from "@/lib/api-helpers";
import { getPublishingLimit, publishToInstagram } from "@/lib/meta/graph-publish";
import { getActiveIgAccount } from "@/lib/services/ig-account.service";

// Phase 0 spike: publishes a reel through Instagram Login (no Facebook Page).
//   ?username=<ig handle>   which connected account (required)
//   &dry=1                  only check the connection + quota, post nothing
//   &url=<https mp4>        public video URL (Instagram downloads it itself)
//   &caption=<text>
export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    requireCronAuth(req);
    const params = new URL(req.url).searchParams;
    const username = params.get("username")?.replace(/^@/, "").trim();
    if (!username) throw new ApiError(400, "Pass ?username=<your instagram handle>.");

    const row = await prisma.igAccount.findFirst({ where: { username }, orderBy: { updatedAt: "desc" } });
    if (!row) throw new ApiError(404, `No connected Instagram account @${username}. Connect it in Settings first.`);
    const active = await getActiveIgAccount(row.userId, row.id);
    if (!active) throw new ApiError(409, `@${username} needs to be reconnected (status ${row.status}).`);

    const limit = await getPublishingLimit(active.account);
    if (params.get("dry") === "1") {
      return NextResponse.json({ ok: true, dryRun: true, account: `@${username}`, igUserId: row.igUserId, limit });
    }

    const videoUrl = params.get("url");
    if (!videoUrl || !videoUrl.startsWith("https://")) {
      throw new ApiError(400, "Pass &url=<public https .mp4 URL>, e.g. the url from /api/dev/render-test.");
    }

    const started = Date.now();
    const result = await publishToInstagram({
      account: active.account,
      kind: "REEL",
      mediaUrl: videoUrl,
      caption: params.get("caption") ?? "Test reel",
    });
    return NextResponse.json({ ...result, account: `@${username}`, limitBefore: limit, ms: Date.now() - started });
  } catch (err) {
    return jsonError(err);
  }
}
