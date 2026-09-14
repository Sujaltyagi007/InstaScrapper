"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import type { TargetWithMonitor } from "@/types/domain";

export function useTargets() {
  const [targets, setTargets] = useState<TargetWithMonitor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ targets: TargetWithMonitor[] }>("/api/targets");
      setTargets(data.targets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load targets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { targets, loading, error, refresh };
}
