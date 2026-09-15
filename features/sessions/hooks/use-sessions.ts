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
}

export function useSessions() {
  const [sessions, setSessions] = useState<InstagramSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ sessions: InstagramSessionSummary[] }>("/api/sessions");
      setSessions(data.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Instagram sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sessions, loading, error, refresh };
}
