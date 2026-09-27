"use client";
import useSWR from "swr";
import { useCallback } from "react";
import { META_STATUS_KEY } from "@/lib/swr-keys";

export { META_STATUS_KEY };

export interface MetaStatus {
  mock: boolean;
  mode: "MOCK" | "GRAPH" | "STEALTH";
  configured: boolean;
  connection: {
    id: string;
    status: string;
    accountType: string | null;
    igUsername: string | null;
    externalUserId: string;
    expiresAt: string | null;
    lastVerifiedAt: string | null;
  } | null;
}

/** Shared by the dashboard banner and the Settings connection card, so they fetch it once, not twice. */
export function useMetaStatus() {
  const { data, isLoading, mutate } = useSWR<MetaStatus>(META_STATUS_KEY);
  // Stable identity so a caller can safely put `refresh` in a useEffect dep array.
  const refresh = useCallback(() => mutate(), [mutate]);
  return { metaStatus: data ?? null, loading: isLoading, refresh };
}
