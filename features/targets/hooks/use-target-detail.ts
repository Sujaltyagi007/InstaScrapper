"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import type { TargetDetail } from "@/types/domain";

export function useTargetDetail(targetId: string) {
  const [target, setTarget] = useState<TargetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ target: TargetDetail }>(`/api/targets/${targetId}`);
      setTarget(data.target);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load target.");
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { target, loading, error, refresh };
}
