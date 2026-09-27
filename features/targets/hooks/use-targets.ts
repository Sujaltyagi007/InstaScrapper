"use client";
import { getTargets } from "../api/target.api";
import type { TargetWithMonitor } from "@/types/domain";
import { useCallback, useEffect, useState } from "react";

export function useTargets() {
  const [targets, setTargets] = useState<TargetWithMonitor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTargets();
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
