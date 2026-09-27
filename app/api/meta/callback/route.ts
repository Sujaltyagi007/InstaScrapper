import { NextResponse } from "next/server";
import { completeMetaConnection, MetaConnectionError } from "@/lib/services/meta-connection.service";
import { verifyOAuthState } from "@/lib/security/oauth-state";

function settingsRedirect(req: Request, params: Record<string, string>): NextResponse {
  const url = new URL("/settings", req.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (error) {
    return settingsRedirect(req, { meta_error: error });
  }
  if (!code || !state) {
    return settingsRedirect(req, { meta_error: "Instagram did not return an authorization code." });
  }

  const userId = verifyOAuthState(state);
  if (!userId) {
    return settingsRedirect(req, { meta_error: "This connection link expired. Please try again." });
  }

  try {
    const { igUsername } = await completeMetaConnection(userId, code);
    return settingsRedirect(req, { meta_connected: igUsername ?? "1" });
  } catch (err) {
    const message =
      err instanceof MetaConnectionError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to connect your Instagram account.";
    console.error("[meta-callback]", message);
    return settingsRedirect(req, { meta_error: message });
  }
}
