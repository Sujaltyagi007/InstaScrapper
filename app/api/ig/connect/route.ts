import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/api-helpers";
import { signOAuthState } from "@/lib/security/oauth-state";
import { buildIgAuthUrl, isIgLoginConfigured } from "@/lib/services/ig-account.service";

/**
 * Starts Instagram Login for the user's own posting account. A browser
 * navigation from Settings, so every outcome is a redirect, not JSON.
 */
export async function GET(req: Request) {
  const settings = (params: Record<string, string>) => {
    const url = new URL("/settings", req.url);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("tab", "connections");
    return NextResponse.redirect(url);
  };

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return settings({ ig_error: "Please sign in again before connecting Instagram." });
  }

  if (!isIgLoginConfigured()) {
    return settings({ ig_error: "INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET are not configured on the server." });
  }
  const state = signOAuthState(userId);
  if (!state) return settings({ ig_error: "Server is missing NEXTAUTH_SECRET." });

  return NextResponse.redirect(buildIgAuthUrl(state));
}
