"use client";

import { signOut } from "next-auth/react";
import { SCREEN_COOKIE } from "@/lib/spa/screens";

/**
 * Logs out with a full page load (next-auth redirects to /login), which also drops
 * everything the kept-alive tabs and the SWR cache hold in memory. The remembered
 * screen is cleared too, so the next person on this browser starts on Dashboard.
 */
export function signOutAndForget() {
  document.cookie = `${SCREEN_COOKIE}=; path=/; max-age=0; samesite=lax`;
  return signOut({ callbackUrl: "/login" });
}
