"use client";

import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import { apiFetch } from "@/lib/fetcher";

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
      }}
    >
      {children}
    </SWRConfig>
  );
}
