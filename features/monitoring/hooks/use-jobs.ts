"use client";
import useSWR from "swr";
import { useCallback } from "react";
import type { JobWithTarget } from "@/types/domain";
import { JOBS_KEY } from "@/lib/swr-keys";
import { friendlyError } from "@/lib/friendly-error";

export function useJobs() {
  const { data, error, isLoading, mutate } = useSWR<{ jobs: JobWithTarget[] }>(JOBS_KEY);
  const refresh = useCallback(() => mutate(), [mutate]);
  return { jobs: data?.jobs ?? null, loading: isLoading, error: error ? friendlyError(error) : null, refresh };
}
