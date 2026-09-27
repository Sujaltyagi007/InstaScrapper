import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { graphGet } from "@/lib/meta/graph-client";
import type { GraphAccountConfig } from "@/lib/meta/types";

export const IG_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

/** Long-lived Instagram tokens last 60 days; refresh well before that. */
const REFRESH_WINDOW_DAYS = 10;
/** Instagram rejects refreshing a token younger than 24h. */
const MIN_TOKEN_AGE_MS = 24 * 60 * 60 * 1000;

export class IgAccountError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "IgAccountError";
  }
}

function isSet(value: string | undefined): value is string {
  return !!value && value.trim().length > 0 && !value.startsWith("your_");
}

export function isIgLoginConfigured(): boolean {
  return isSet(process.env.INSTAGRAM_APP_ID) && isSet(process.env.INSTAGRAM_APP_SECRET);
}

function appCredentials(): { appId: string; appSecret: string } {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!isSet(appId) || !isSet(appSecret)) {
    throw new IgAccountError("INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET are not configured.", "IG_NOT_CONFIGURED");
  }
  return { appId: appId.trim(), appSecret: appSecret.trim() };
}

export function igRedirectUri(): string {
  const base =
    process.env.META_REDIRECT_BASE_URL || process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/ig/callback`;
}

export function buildIgAuthUrl(state: string): string {
  const { appId } = appCredentials();
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", igRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", IG_SCOPES.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCode(code: string): Promise<string> {
  const { appId, appSecret } = appCredentials();
  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: igRedirectUri(),
      // Instagram appends "#_" to the redirect; it isn't part of the code.
      code: code.replace(/#_$/, ""),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error_message?: string;
    error?: { message?: string };
  };
  if (!res.ok || !body.access_token) {
    const message = body.error_message ?? body.error?.message ?? `Token exchange failed (${res.status}).`;
    throw new IgAccountError(message, "IG_TOKEN_EXCHANGE_FAILED");
  }
  return body.access_token;
}

async function exchangeForLongLived(shortLived: string): Promise<{ accessToken: string; expiresAt: Date | null }> {
  const { appSecret } = appCredentials();
  const res = await fetch(
    `https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: appSecret,
      access_token: shortLived,
    })}`,
  );
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!res.ok || !body.access_token) {
    throw new IgAccountError(body.error?.message ?? `Long-lived token exchange failed (${res.status}).`, "IG_TOKEN_EXCHANGE_FAILED");
  }
  return {
    accessToken: body.access_token,
    expiresAt: typeof body.expires_in === "number" ? new Date(Date.now() + body.expires_in * 1000) : null,
  };
}

async function refreshLongLived(token: string): Promise<{ accessToken: string; expiresAt: Date | null }> {
  const res = await fetch(
    `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: token,
    })}`,
  );
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (res.status >= 500) throw new Error(`Instagram token refresh unavailable (${res.status}).`);
  if (!res.ok || !body.access_token) {
    throw new IgAccountError(body.error?.message ?? `Token refresh failed (${res.status}).`, "IG_TOKEN_REFRESH_FAILED");
  }
  return {
    accessToken: body.access_token,
    expiresAt: typeof body.expires_in === "number" ? new Date(Date.now() + body.expires_in * 1000) : null,
  };
}

/** Full OAuth callback handling: code -> stored, encrypted connection. */
export async function completeIgConnection(userId: string, code: string): Promise<{ username: string | null }> {
  const shortLived = await exchangeCode(code);
  const { accessToken, expiresAt } = await exchangeForLongLived(shortLived);

  // `user_id` is the professional account id used for publishing; `id` is only app-scoped.
  const me = await graphGet<{ user_id?: string; username?: string; account_type?: string }>(
    "/me",
    { fields: "user_id,username,account_type", access_token: accessToken },
    { host: "instagram" },
  );
  if (!me.user_id) {
    throw new IgAccountError("Instagram did not return an account id.", "IG_NO_ACCOUNT");
  }

  const encrypted = encryptSecret(accessToken);
  const data = {
    username: me.username ?? null,
    accountType: me.account_type ?? null,
    encryptedAccessToken: encrypted.ciphertext,
    encryptedTokenIv: encrypted.iv,
    scopes: IG_SCOPES,
    status: "ACTIVE",
    tokenExpiresAt: expiresAt,
    tokenRefreshedAt: new Date(),
  };
  await prisma.igAccount.upsert({
    where: { userId_igUserId: { userId, igUserId: me.user_id } },
    create: { userId, igUserId: me.user_id, ...data },
    update: data,
  });
  return { username: me.username ?? null };
}

export interface ActiveIgAccount {
  id: string;
  account: GraphAccountConfig;
  postingPaused: boolean;
  pausedReason: string | null;
}

/** The posting identity, or null when nothing usable is connected. */
export async function getActiveIgAccount(userId: string, igAccountId?: string): Promise<ActiveIgAccount | null> {
  const row = await prisma.igAccount.findFirst({
    where: { userId, status: "ACTIVE", ...(igAccountId ? { id: igAccountId } : {}) },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) return null;

  let accessToken: string;
  try {
    accessToken = decryptSecret({ ciphertext: row.encryptedAccessToken, iv: row.encryptedTokenIv });
  } catch {
    // An undecryptable token (e.g. ENCRYPTION_KEY changed) can never work; force a reconnect.
    await prisma.igAccount.update({ where: { id: row.id }, data: { status: "ERROR" } });
    return null;
  }

  return {
    id: row.id,
    account: { igUserId: row.igUserId, accessToken, igUsername: row.username, host: "instagram" },
    postingPaused: row.postingPaused,
    pausedReason: row.pausedReason,
  };
}

/** Flags a connection for re-auth after Instagram rejects its token (code 190). */
export async function markIgReauthRequired(id: string): Promise<void> {
  await prisma.igAccount.update({ where: { id }, data: { status: "REAUTH_REQUIRED" } });
}

export async function listIgAccounts(userId: string) {
  return prisma.igAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      igUserId: true,
      username: true,
      accountType: true,
      status: true,
      tokenExpiresAt: true,
      postingPaused: true,
      pausedReason: true,
      createdAt: true,
    },
  });
}

export async function disconnectIgAccount(userId: string, id: string): Promise<void> {
  await prisma.igAccount.deleteMany({ where: { id, userId } });
}

/** Refreshes tokens that expire within the window. Run daily. */
export async function refreshDueIgTokens(): Promise<{ refreshed: number; failed: number; skipped: number }> {
  const cutoff = new Date(Date.now() + REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const due = await prisma.igAccount.findMany({
    where: { status: "ACTIVE", OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { lte: cutoff } }] },
  });

  let refreshed = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of due) {
    if (row.tokenRefreshedAt.getTime() > Date.now() - MIN_TOKEN_AGE_MS) {
      skipped += 1;
      continue;
    }
    try {
      const current = decryptSecret({ ciphertext: row.encryptedAccessToken, iv: row.encryptedTokenIv });
      const { accessToken, expiresAt } = await refreshLongLived(current);
      const encrypted = encryptSecret(accessToken);
      await prisma.igAccount.update({
        where: { id: row.id },
        data: {
          encryptedAccessToken: encrypted.ciphertext,
          encryptedTokenIv: encrypted.iv,
          tokenExpiresAt: expiresAt,
          tokenRefreshedAt: new Date(),
        },
      });
      refreshed += 1;
    } catch (error) {
      failed += 1;
      if (error instanceof IgAccountError) await markIgReauthRequired(row.id);
      console.warn(`[ig-account] refresh failed for ${row.id}: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  return { refreshed, failed, skipped };
}
