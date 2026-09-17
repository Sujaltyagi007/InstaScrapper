"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";

/** Mirrors lib/services/quota.service.ts `TargetQuota` (server-only module). */
export interface TargetQuota {
  used: number;
  limit: number;
  remaining: number;
  warnAt: number;
  level: "OK" | "WARN" | "FULL";
  minLimit: number;
  maxLimit: number;
  defaultLimit: number;
}

export function useTargetQuota() {
  const [quota, setQuota] = useState<TargetQuota | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ quota: TargetQuota }>("/api/account/quota");
      setQuota(data.quota);
    } catch {
      // Non-critical: the server still enforces the limit, so a failed read
      // just means no banner rather than a broken page.
      setQuota(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateLimit = useCallback(async (maxTargets: number) => {
    const data = await apiFetch<{ quota: TargetQuota }>("/api/account/quota", {
      method: "PATCH",
      body: JSON.stringify({ maxTargets }),
    });
    setQuota(data.quota);
    return data.quota;
  }, []);

  return { quota, loading, refresh, updateLimit };
}
