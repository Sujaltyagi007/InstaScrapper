"use client";
import useSWR from "swr";
import { useCallback } from "react";
import { apiFetch } from "@/lib/fetcher";
import { SESSIONS_KEY } from "@/lib/swr-keys";
import { friendlyError } from "@/lib/friendly-error";

export interface InstagramSessionSummary {
  id: string;
  username: string;
  authMethod: string;
  userAgent: string | null;
  impersonateTarget: string;
  proxyUrl: string | null;
  status: "ACTIVE" | "FLAGGED" | "CHECKPOINT_REQUIRED" | "EXPIRED" | "PAUSED";
  lastTestedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  cooldownUntil: string | null;
}

export interface PoolHealth {
  total: number;
  active: number;
  cooling: number;
  flagged: number;
  nextAvailableAt: string | null;
}

type SessionsPayload = { sessions: InstagramSessionSummary[]; poolHealth: PoolHealth };

export function useSessions() {
  const { data, error, isLoading, mutate } = useSWR<SessionsPayload>(SESSIONS_KEY);
  const refresh = useCallback(() => mutate(), [mutate]);

  const patch = useCallback(
    async (id: string, body: object, optimistic: Partial<InstagramSessionSummary>) => {
      // Optimistic: the row changes at once; the re-fetch after corrects it either way.
      mutate(
        (cur) => cur && { ...cur, sessions: cur.sessions.map((s) => (s.id === id ? { ...s, ...optimistic } : s)) },
        { revalidate: false },
      );
      try {
        await apiFetch(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      } finally {
        await mutate();
      }
    },
    [mutate],
  );

  const setSessionStatus = useCallback(
    (id: string, status: "ACTIVE" | "PAUSED") => patch(id, { status }, { status }),
    [patch],
  );
  const resetSession = useCallback(
    (id: string) => patch(id, { resetFlag: true }, { status: "ACTIVE", lastErrorMessage: null }),
    [patch],
  );

  return {
    sessions: data?.sessions ?? null,
    poolHealth: data?.poolHealth ?? null,
    loading: isLoading,
    error: error ? friendlyError(error) : null,
    refresh,
    mutate,
    setSessionStatus,
    resetSession,
  };
}
