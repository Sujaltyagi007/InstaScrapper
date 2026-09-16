"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";

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

export function useSessions() {
  const [sessions, setSessions] = useState<InstagramSessionSummary[] | null>(null);
  const [poolHealth, setPoolHealth] = useState<PoolHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ sessions: InstagramSessionSummary[], poolHealth: PoolHealth }>("/api/sessions");
      setSessions(data.sessions);
      setPoolHealth(data.poolHealth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Instagram sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setSessionStatus = useCallback(async (id: string, status: "ACTIVE" | "PAUSED") => {
    try {
      await apiFetch(`/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await refresh();
    } catch (err) {
      throw err;
    }
  }, [refresh]);

  const resetSession = useCallback(async (id: string) => {
    try {
      await apiFetch(`/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ resetFlag: true }),
      });
      await refresh();
    } catch (err) {
      throw err;
    }
  }, [refresh]);

  return { sessions, poolHealth, loading, error, refresh, setSessionStatus, resetSession };
}
