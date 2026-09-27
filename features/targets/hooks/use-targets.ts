"use client";
import useSWR from "swr";
import { useCallback } from "react";
import { getTargets } from "../api/target.api";
import type { TargetWithMonitor } from "@/types/domain";
import { TARGETS_KEY } from "@/lib/swr-keys";
import { friendlyError } from "@/lib/friendly-error";

export { TARGETS_KEY };

/**
 * Same shape as before (targets/loading/error/refresh) so callers don't
 * change, now backed by SWR: cached across navigations, deduped across
 * components, and correctable with `mutate(TARGETS_KEY, ...)` for optimistic
 * updates (see the targets page). `error` is already user-friendly text.
 */
export function useTargets() {
  const { data, error, isLoading, mutate } = useSWR<{ targets: TargetWithMonitor[] }>(TARGETS_KEY, getTargets);
  const refresh = useCallback(() => mutate(), [mutate]);

  return {
    targets: data?.targets ?? null,
    loading: isLoading,
    error: error ? friendlyError(error) : null,
    refresh,
  };
}
