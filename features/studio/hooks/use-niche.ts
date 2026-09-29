"use client";

import useSWR from "swr";
import { useCallback } from "react";
import { NICHE_KEY } from "@/lib/swr-keys";
import { friendlyError } from "@/lib/friendly-error";

export interface NicheAccountRow {
  id: string;
  source: string;
  target: {
    id: string;
    username: string;
    status: string;
    errorMessage: string | null;
    lastSuccessAt: string | null;
    monitor: { purpose: string } | null;
    _count: { media: number };
  };
}

export interface NichePostRow {
  id: string;
  permalink: string | null;
  mediaType: string;
  caption: string | null;
  timestamp: string | null;
  playCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  metricsUpdatedAt: string | null;
  target: { username: string };
}

export interface NicheData {
  niche: {
    id: string;
    name: string;
    description: string | null;
    language: string;
    accounts: NicheAccountRow[];
  } | null;
  hasActiveSession: boolean;
  posts: NichePostRow[];
}

export function useNiche() {
  const { data, error, isLoading, mutate } = useSWR<NicheData>(NICHE_KEY);
  const refresh = useCallback(() => mutate(), [mutate]);
  return { data: data ?? null, loading: isLoading, error: error ? friendlyError(error) : null, refresh };
}
