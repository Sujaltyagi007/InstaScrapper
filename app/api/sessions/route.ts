import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { encryptJson } from "@/lib/crypto";
import {
  stealthTestSession,
  stealthImportBrowserSession,
} from "@/lib/meta/stealth-engine-bridge";

function parseCookieString(raw: string): Record<string, string> {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  const cookies: Record<string, string> = {};
  const parts = trimmed.split(";");
  for (const part of parts) {
    const [k, ...v] = part.trim().split("=");
    if (k && v.length > 0) {
      cookies[k.trim()] = v.join("=").trim();
    }
  }
  return cookies;
}

export async function GET() {
  try {
    const userId = await requireUserId();
    const sessions = await prisma.instagramSession.findMany({
      where: { userId },
      select: {
        id: true,
        username: true,
        authMethod: true,
        userAgent: true,
        impersonateTarget: true,
        proxyUrl: true,
        status: true,
        lastTestedAt: true,
        lastSuccessAt: true,
        lastErrorMessage: true,
        createdAt: true,
        updatedAt: true,
        lastUsedAt: true,
        cooldownUntil: true,
      },
      orderBy: { createdAt: "desc" },
    });
    const now = new Date();
    const active = sessions.filter(s => s.status === "ACTIVE" && (!s.cooldownUntil || s.cooldownUntil < now)).length;
    const cooling = sessions.filter(s => s.status === "ACTIVE" && s.cooldownUntil && s.cooldownUntil > now);
    const flagged = sessions.filter(s => s.status === "FLAGGED").length;
    
    let nextAvailableAt = null;
    if (cooling.length > 0) {
      nextAvailableAt = cooling.map(s => s.cooldownUntil!).sort((a, b) => a.getTime() - b.getTime())[0];
    }

    const poolHealth = {
      total: sessions.length,
      active,
      cooling: cooling.length,
      flagged,
      nextAvailableAt
    };

    return NextResponse.json({ sessions, poolHealth });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = await req.json();

    const {
      authMethod = "COOKIE_INPUT", // "COOKIE_INPUT" | "BROWSER"
      browser = "firefox",
      rawCookies,
      proxyUrl,
      userAgent,
      impersonateTarget = "auto",
    } = body;

    let cookies: Record<string, string> = {};
    let detectedUsername = "";

    if (authMethod === "BROWSER") {
      const importRes = await stealthImportBrowserSession({
        browser,
        proxyUrl,
        userAgent,
      });

      if (!importRes.ok || !importRes.cookies) {
        return NextResponse.json(
          { error: importRes.message || "Failed to import browser cookies." },
          { status: 400 }
        );
      }
      cookies = importRes.cookies;
      detectedUsername = importRes.username || "instagram_user";
    } else {
      if (!rawCookies || typeof rawCookies !== "string") {
        return NextResponse.json(
          { error: "Please provide valid session cookies." },
          { status: 400 }
        );
      }
      try {
        cookies = parseCookieString(rawCookies);
      } catch {
        return NextResponse.json(
          { error: "Could not parse cookies. Provide key=value pairs or JSON." },
          { status: 400 }
        );
      }

      if (!cookies.sessionid && !cookies.ds_user_id) {
        return NextResponse.json(
          { error: "Cookies must contain at least 'sessionid' or 'ds_user_id'." },
          { status: 400 }
        );
      }

      // Test session with engine
      const testRes = await stealthTestSession({
        cookies,
        proxyUrl,
        userAgent,
        impersonateTarget,
      });

      if (!testRes.ok) {
        return NextResponse.json(
          {
            error: testRes.message || "Instagram rejected these session cookies.",
            flagged: testRes.flagged,
          },
          { status: 400 }
        );
      }
      detectedUsername = testRes.username || cookies.ds_user_id || "instagram_user";
    }

    const encrypted = encryptJson(cookies);

    const sessionRecord = await prisma.instagramSession.create({
      data: {
        userId,
        username: detectedUsername,
        authMethod: authMethod === "BROWSER" ? browser.toUpperCase() : "COOKIE_INPUT",
        encryptedCookies: encrypted.ciphertext,
        encryptedCookiesIv: encrypted.iv,
        userAgent: userAgent || null,
        impersonateTarget,
        proxyUrl: proxyUrl || null,
        status: "ACTIVE",
        lastTestedAt: new Date(),
        lastSuccessAt: new Date(),
      },
    });

    return NextResponse.json(
      {
        session: {
          id: sessionRecord.id,
          username: sessionRecord.username,
          status: sessionRecord.status,
          authMethod: sessionRecord.authMethod,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return jsonError(err);
  }
}
