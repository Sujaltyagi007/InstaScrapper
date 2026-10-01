"use client";

import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import { apiFetch, FetchError } from "@/lib/fetcher";

/**
 * Global cache for every apiFetch-backed hook. Two components asking for the
 * same URL at once (e.g. SystemHealthBadge rendered in both the desktop
 * sidebar and the mobile menu) share one request instead of firing two, and
 * navigating back to a page already in cache paints instantly while SWR
 * quietly re-checks in the background.
 */
export function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: (url: string) => apiFetch(url),
        dedupingInterval: 4000,
        // A stale row/badge for a couple of minutes is fine here; still
        // corrected instantly by the optimistic updates on user actions.
        focusThrottleInterval: 15000,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        keepPreviousData: true,
        shouldRetryOnError: false,
        // The app is one long-lived page, so a login that expires while it's open
        // would otherwise leave every tab showing errors. Go to the login page once.
        onError: (err) => {
          if (err instanceof FetchError && err.status === 401 && window.location.pathname !== "/login") {
            window.location.assign("/login");
          }
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
