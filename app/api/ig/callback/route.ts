import { NextResponse } from "next/server";
import { verifyOAuthState } from "@/lib/security/oauth-state";
import { completeIgConnection } from "@/lib/services/ig-account.service";

function settings(req: Request, params: Record<string, string>): NextResponse {
  const url = new URL("/settings", req.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("tab", "connections");
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (error) return settings(req, { ig_error: error });
  if (!code || !state) return settings(req, { ig_error: "Instagram did not return an authorization code." });

  const userId = verifyOAuthState(state);
  if (!userId) return settings(req, { ig_error: "This connection link expired. Please try again." });

  try {
    const { username } = await completeIgConnection(userId, code);
    return settings(req, { ig_connected: username ?? "1" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to connect your Instagram account.";
    console.error("[ig-callback]", message);
    return settings(req, { ig_error: message });
  }
}
