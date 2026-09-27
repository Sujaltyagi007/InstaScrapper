import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/api-helpers";
import { buildMetaAuthUrl } from "@/lib/services/meta-connection.service";
import { signOAuthState } from "@/lib/security/oauth-state";

/**
 * Starts the Facebook Login OAuth flow for connecting the user's own Instagram
 * professional account. This is a browser navigation (the Settings page links
 * straight here), so it redirects rather than returning JSON.
 *
 * The `state` value is HMAC-signed and short-lived, and the callback only trusts
 * a userId that came out of a valid signature — otherwise someone could hand the
 * user a callback URL that attaches THEIR Instagram account to this user.
 */
export async function GET(req: Request) {
  const settingsUrl = (params: Record<string, string>) => {
    const url = new URL("/settings", req.url);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return NextResponse.redirect(url);
  };

  try {
    const userId = await requireUserId();
    const state = signOAuthState(userId);
    if (!state) {
      return settingsUrl({ meta_error: "Server is missing NEXTAUTH_SECRET." });
    }
    if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
      return settingsUrl({
        meta_error: "META_APP_ID and META_APP_SECRET are not configured on the server.",
      });
    }

    return NextResponse.redirect(buildMetaAuthUrl(state));
  } catch {
    // Unauthenticated or similar — send them somewhere useful, not a JSON blob.
    return settingsUrl({ meta_error: "Please sign in again before connecting Instagram." });
  }
}
