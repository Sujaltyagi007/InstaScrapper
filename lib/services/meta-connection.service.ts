import { prisma } from "@/lib/prisma";
import { graphGet } from "@/lib/meta/graph-client";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { GraphAccountConfig } from "@/lib/meta/types";

export const META_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "pages_read_engagement",
  "pages_show_list",
];

/** Long-lived Facebook user tokens last ~60 days. Refresh well before that. */
const REFRESH_WINDOW_DAYS = 10;

export class MetaConnectionError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "MetaConnectionError";
  }
}

function appCredentials(): { appId: string; appSecret: string } {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new MetaConnectionError(
      "META_APP_ID and META_APP_SECRET are not configured.",
      "META_NOT_CONFIGURED",
    );
  }
  return { appId, appSecret };
}

export function metaRedirectUri(): string {
  const base =
    process.env.META_REDIRECT_BASE_URL ||
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/meta/callback`;
}

/** Step 1 of OAuth: where to send the user's browser. */
export function buildMetaAuthUrl(state: string): string {
  const { appId } = appCredentials();
  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", metaRedirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("scope", META_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

/** Step 2: code -> short-lived user token. */
async function exchangeCodeForToken(code: string): Promise<string> {
  const { appId, appSecret } = appCredentials();
  const res = await graphGet<{ access_token: string }>("/oauth/access_token", {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: metaRedirectUri(),
    code,
  });
  return res.access_token;
}

/** Step 3: short-lived -> long-lived (~60 day) user token. */
async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{
  accessToken: string;
  expiresInSeconds: number | null;
}> {
  const { appId, appSecret } = appCredentials();
  const res = await graphGet<{ access_token: string; expires_in?: number }>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });
  return {
    accessToken: res.access_token,
    expiresInSeconds: typeof res.expires_in === "number" ? res.expires_in : null,
  };
}

/**
 * Step 4: find the Instagram professional account behind the user's Pages.
 * The IG account must be linked to a Facebook Page — that linkage is exactly
 * what the Facebook Login path requires, and why Business Discovery works here
 * while the Instagram-Login path can't reach it at all.
 */
async function discoverInstagramAccount(userToken: string): Promise<{
  igUserId: string;
  igUsername: string | null;
  pageId: string;
}> {
  const pages = await graphGet<{
    data?: Array<{
      id: string;
      name?: string;
      instagram_business_account?: { id: string; username?: string };
    }>;
  }>("/me/accounts", {
    fields: "id,name,instagram_business_account{id,username}",
    access_token: userToken,
  });

  const withIg = (pages.data ?? []).find((page) => page.instagram_business_account?.id);
  if (!withIg?.instagram_business_account) {
    throw new MetaConnectionError(
      "No Instagram professional account found. Convert your Instagram account to Business or Creator and link it to a Facebook Page you manage, then try again.",
      "NO_IG_ACCOUNT",
    );
  }
  return {
    igUserId: withIg.instagram_business_account.id,
    igUsername: withIg.instagram_business_account.username ?? null,
    pageId: withIg.id,
  };
}

/** Full OAuth callback handling: code -> stored, encrypted connection. */
export async function completeMetaConnection(userId: string, code: string): Promise<{
  igUserId: string;
  igUsername: string | null;
}> {
  const shortLived = await exchangeCodeForToken(code);
  const { accessToken, expiresInSeconds } = await exchangeForLongLivedToken(shortLived);
  const { igUserId, igUsername, pageId } = await discoverInstagramAccount(accessToken);

  const encrypted = encryptSecret(accessToken);
  const expiresAt = expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : null;

  // One connection per user per IG account; re-connecting refreshes it in place.
  const existing = await prisma.metaConnection.findFirst({
    where: { userId, externalUserId: igUserId },
  });

  const data = {
    userId,
    provider: "meta",
    externalUserId: igUserId,
    accountType: "BUSINESS",
    igUsername,
    pageId,
    encryptedAccessToken: encrypted.ciphertext,
    encryptedTokenIv: encrypted.iv,
    scopes: META_SCOPES,
    status: "ACTIVE" as const,
    expiresAt,
    lastVerifiedAt: new Date(),
  };

  if (existing) {
    await prisma.metaConnection.update({ where: { id: existing.id }, data });
  } else {
    await prisma.metaConnection.create({ data });
  }

  return { igUserId, igUsername };
}

/**
 * The caller identity for every Graph read/publish. Returns null when the user
 * hasn't connected an account — callers then surface "connect your account"
 * rather than failing opaquely.
 */
export async function getActiveGraphAccount(userId: string): Promise<GraphAccountConfig | null> {
  const connection = await prisma.metaConnection.findFirst({
    where: { userId, provider: "meta", status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
  });
  if (!connection) return null;

  let accessToken: string;
  try {
    accessToken = decryptSecret({
      ciphertext: connection.encryptedAccessToken,
      iv: connection.encryptedTokenIv,
    });
  } catch {
    // A token we can't decrypt is unusable; force a reconnect instead of
    // reporting a confusing Graph error on every check.
    await prisma.metaConnection.update({
      where: { id: connection.id },
      data: { status: "ERROR" },
    });
    return null;
  }

  return {
    igUserId: connection.externalUserId,
    accessToken,
    igUsername: connection.igUsername,
  };
}

/** Flags a connection as needing re-auth (called when Graph returns code 190). */
export async function markConnectionReauthRequired(userId: string): Promise<void> {
  await prisma.metaConnection.updateMany({
    where: { userId, provider: "meta", status: "ACTIVE" },
    data: { status: "REAUTH_REQUIRED" },
  });
}

export async function listMetaConnections(userId: string) {
  return prisma.metaConnection.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      externalUserId: true,
      igUsername: true,
      pageId: true,
      status: true,
      expiresAt: true,
      lastVerifiedAt: true,
      createdAt: true,
    },
  });
}

export async function disconnectMeta(userId: string, id: string): Promise<void> {
  await prisma.metaConnection.deleteMany({ where: { id, userId } });
}

/**
 * Refreshes long-lived tokens that are inside the expiry window. Facebook
 * long-lived user tokens are refreshed by exchanging them again (allowed after
 * 24h), so this is the same `fb_exchange_token` call with the current token.
 * Run on a schedule — waiting for a 401 means checks fail first.
 */
export async function refreshDueMetaTokens(): Promise<{
  refreshed: number;
  failed: number;
  skipped: number;
}> {
  const cutoff = new Date(Date.now() + REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const due = await prisma.metaConnection.findMany({
    where: {
      provider: "meta",
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { lte: cutoff } }],
    },
  });

  let refreshed = 0;
  let failed = 0;
  let skipped = 0;

  for (const connection of due) {
    // Never re-exchange a token minted in the last 24h — Facebook rejects it.
    if (connection.updatedAt.getTime() > Date.now() - 24 * 60 * 60 * 1000) {
      skipped += 1;
      continue;
    }
    try {
      const current = decryptSecret({
        ciphertext: connection.encryptedAccessToken,
        iv: connection.encryptedTokenIv,
      });
      const { accessToken, expiresInSeconds } = await exchangeForLongLivedToken(current);
      const encrypted = encryptSecret(accessToken);
      await prisma.metaConnection.update({
        where: { id: connection.id },
        data: {
          encryptedAccessToken: encrypted.ciphertext,
          encryptedTokenIv: encrypted.iv,
          expiresAt: expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : null,
          lastVerifiedAt: new Date(),
        },
      });
      refreshed += 1;
    } catch (error) {
      failed += 1;
      await prisma.metaConnection.update({
        where: { id: connection.id },
        data: { status: "REAUTH_REQUIRED" },
      });
      console.warn(
        `[meta-connection] refresh failed for ${connection.id}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  return { refreshed, failed, skipped };
}
