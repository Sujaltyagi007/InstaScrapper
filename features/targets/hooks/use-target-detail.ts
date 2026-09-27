"use client";
import useSWR, { preload } from "swr";
import { useCallback } from "react";
import { apiFetch } from "@/lib/fetcher";
import type { TargetDetail } from "@/types/domain";
import { targetDetailKey } from "@/lib/swr-keys";
import { friendlyError } from "@/lib/friendly-error";

export { targetDetailKey };

export function useTargetDetail(targetId: string) {
  const { data, error, isLoading, mutate } = useSWR<{ target: TargetDetail }>(targetDetailKey(targetId));
  const refresh = useCallback(() => mutate(), [mutate]);

  return {
    target: data?.target ?? null,
    loading: isLoading,
    error: error ? friendlyError(error) : null,
    notFound: (error as { status?: number } | undefined)?.status === 404,
    refresh,
    mutate,
  };
}

/** Warms the cache for a target's detail page — call on row hover so the click feels instant. */
export function prefetchTargetDetail(targetId: string) {
  preload(targetDetailKey(targetId), (url: string) => apiFetch(url));
}
