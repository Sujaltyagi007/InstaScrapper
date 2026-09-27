"use client";
import useSWR from "swr";
import { useCallback } from "react";
import { apiFetch } from "@/lib/fetcher";
import { TARGET_QUOTA_KEY } from "@/lib/swr-keys";

export { TARGET_QUOTA_KEY };

export interface TargetQuota {
  used: number;
  limit: number;
  remaining: number;
  warnAt: number;
  level: "OK" | "WARN" | "FULL";
  minLimit: number;
  maxLimit: number;
  defaultLimit: number;
}

export function useTargetQuota() {
  const { data, isLoading, mutate } = useSWR<{ quota: TargetQuota }>(TARGET_QUOTA_KEY);

  const updateLimit = useCallback(
    async (maxTargets: number) => {
      const res = await apiFetch<{ quota: TargetQuota }>(TARGET_QUOTA_KEY, {
        method: "PATCH",
        body: JSON.stringify({ maxTargets }),
      });
      await mutate(res, { revalidate: false });
      return res.quota;
    },
    [mutate],
  );
  const refresh = useCallback(() => mutate(), [mutate]);

  return { quota: data?.quota ?? null, loading: isLoading, refresh, updateLimit };
}
