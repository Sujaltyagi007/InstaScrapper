import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { isMockMetaApi } from "./provider-factory";

const GRAPH_OAUTH_BASE = "https://www.facebook.com/dialog/oauth";
const GRAPH_TOKEN_BASE = "https://graph.facebook.com";
const REQUIRED_SCOPES = ["instagram_basic", "pages_show_list", "business_management"];

export function buildAuthorizeUrl(state: string): string {
  if (!process.env.META_APP_ID || !process.env.META_REDIRECT_URI) {
    throw new Error("META_APP_ID and META_REDIRECT_URI must be set to start a real Meta authorization.");
  }
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    state,
    scope: REQUIRED_SCOPES.join(","),
    response_type: "code",
  });
  return `${GRAPH_OAUTH_BASE}?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string) {
  const apiVersion = process.env.META_GRAPH_API_VERSION || "v21.0";
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    redirect_uri: process.env.META_REDIRECT_URI!,
    code,
  });
  const res = await fetch(`${GRAPH_TOKEN_BASE}/${apiVersion}/oauth/access_token?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Meta token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { access_token: string; token_type: string; expires_in?: number };
}


export async function createMockConnection(userId: string) {
  const fakeToken = `mock_token_${crypto.randomBytes(16).toString("hex")}`;
  const encrypted = encryptSecret(fakeToken);

  return prisma.metaConnection.upsert({
    where: { id: `mock-${userId}` },
    create: {
      id: `mock-${userId}`,
      userId,
      provider: "meta",
      externalUserId: `mock_user_${userId}`,
      accountType: "BUSINESS",
      encryptedAccessToken: encrypted.ciphertext,
      encryptedTokenIv: encrypted.iv,
      scopes: REQUIRED_SCOPES,
      status: "ACTIVE",
      lastVerifiedAt: new Date(),
    },
    update: {
      status: "ACTIVE",
      lastVerifiedAt: new Date(),
    },
  });
}

export { isMockMetaApi };
