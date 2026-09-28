import { NextResponse } from "next/server";
import { resolveSessionProxy, UnsafeSessionProxyError } from "@/lib/meta/proxy-identity";
import { z } from "zod";
import { requireUserId, jsonError, ApiError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { encryptJson } from "@/lib/crypto";
import { encryptProxyUrl } from "@/lib/meta/proxy-secret";
import { instagramLogin, instagramSubmitTwoFactor, type LoginResult } from "@/lib/meta/instagram-login";
import { stealthTestSession } from "@/lib/meta/stealth-engine-bridge";

// Bootstrap + login + optional 2FA + a session-validity check — allow headroom.
export const maxDuration = 120;

const loginSchema = z.object({
  username: z.string().trim().min(1).max(60),
  password: z.string().min(1).max(200),
  proxyUrl: z.string().trim().url().optional().or(z.literal("")),
  // 2FA follow-up: when present, the client is completing a challenge from a
  // prior response rather than starting a fresh login.
  twoFactor: z
    .object({
      code: z.string().trim().min(4).max(8),
      identifier: z.string().min(1),
      csrftoken: z.string().min(1),
      mid: z.string().min(1),
    })
    .optional(),
});

/** Persists a successful login's cookies as an InstagramSession (burner pool). */
async function storeSession(userId: string, username: string, cookies: Record<string, string>, proxyUrl: string | null) {
  // Confirm the captured cookies actually work before saving, using the same
  // check the manual-paste flow uses.
  const test = await stealthTestSession({ cookies, proxyUrl, impersonateTarget: "auto" });
  const encrypted = encryptJson(cookies);
  const record = await prisma.instagramSession.create({
    data: {
      userId,
      username: test.username || username,
      authMethod: "PASSWORD_LOGIN",
      encryptedCookies: encrypted.ciphertext,
      encryptedCookiesIv: encrypted.iv,
      ...encryptProxyUrl(proxyUrl || null),
      impersonateTarget: "auto",
      status: test.flagged ? "FLAGGED" : "ACTIVE",
      lastTestedAt: new Date(),
      lastSuccessAt: test.ok ? new Date() : null,
    },
    select: { id: true, username: true, status: true, authMethod: true },
  });
  return record;
}

function respondToResult(result: LoginResult) {
  switch (result.status) {
    case "two_factor_required":
      return NextResponse.json({
        status: "two_factor_required",
        // Handed back so the client can complete the challenge; these are not
        // secrets (a csrftoken + device id), and the password is never returned.
        twoFactor: {
          identifier: result.twoFactorIdentifier,
          csrftoken: result.bootstrap.csrftoken,
          mid: result.bootstrap.mid,
        },
      });
    case "checkpoint_required":
      throw new ApiError(409, result.message, "IG_CHECKPOINT");
    case "bad_credentials":
      throw new ApiError(401, result.message, "IG_BAD_CREDENTIALS");
    case "error":
      throw new ApiError(502, result.message, "IG_LOGIN_ERROR");
    default:
      throw new ApiError(500, "Unexpected login state.");
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = loginSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input.");
    }
    const { username, password, proxyUrl, twoFactor } = parsed.data;
    // A fixed IP of its own, never the server's connection. The 2FA step
    // resolves to the same proxy (lowest free number, nothing saved in between).
    let proxy: string;
    try {
      proxy = await resolveSessionProxy(proxyUrl);
    } catch (err) {
      if (err instanceof UnsafeSessionProxyError) throw new ApiError(400, err.message);
      throw err;
    }

    const result = twoFactor
      ? await instagramSubmitTwoFactor({
        username,
        code: twoFactor.code,
        twoFactorIdentifier: twoFactor.identifier,
        bootstrap: { csrftoken: twoFactor.csrftoken, mid: twoFactor.mid },
        proxyUrl: proxy,
      })
      : await instagramLogin({ username, password, proxyUrl: proxy });

    if (result.status === "authenticated") {
      const session = await storeSession(userId, username, result.cookies, proxy);
      return NextResponse.json({ status: "authenticated", session }, { status: 201 });
    }
    return respondToResult(result);
  } catch (err) {
    return jsonError(err);
  }
}
