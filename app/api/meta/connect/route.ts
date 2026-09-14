import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { isMockMetaApi, buildAuthorizeUrl, createMockConnection } from "@/lib/meta/oauth.service";

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();

    if (isMockMetaApi()) {
      await createMockConnection(userId);
      return NextResponse.redirect(new URL("/settings?connected=mock", req.url));
    }

    const state = crypto.randomBytes(16).toString("hex");
    const url = buildAuthorizeUrl(state);
    const response = NextResponse.redirect(url);
    response.cookies.set("meta_oauth_state", state, { httpOnly: true, secure: true, maxAge: 600, path: "/" });
    return response;
  } catch (err) {
    return jsonError(err);
  }
}
