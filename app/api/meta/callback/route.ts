import { NextResponse } from "next/server";
import { requireUserId, jsonError, ApiError } from "@/lib/api-helpers";
import { exchangeCodeForToken } from "@/lib/meta/oauth.service";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = req.headers
      .get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("meta_oauth_state="))
      ?.split("=")[1];

    if (!code) throw new ApiError(400, "Missing authorization code.");
    if (!state || !cookieState || state !== cookieState) {
      throw new ApiError(400, "Invalid OAuth state.");
    }

    const token = await exchangeCodeForToken(code);
    const encrypted = encryptSecret(token.access_token);

    await prisma.metaConnection.create({
      data: {
        userId,
        provider: "meta",
        externalUserId: "unknown", // populate from a /me call once real Graph API integration is implemented
        encryptedAccessToken: encrypted.ciphertext,
        encryptedTokenIv: encrypted.iv,
        scopes: [],
        status: "ACTIVE",
        expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
        lastVerifiedAt: new Date(),
      },
    });

    return NextResponse.redirect(new URL("/settings?connected=1", req.url));
  } catch (err) {
    return jsonError(err);
  }
}
