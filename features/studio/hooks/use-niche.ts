"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";

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

export interface NicheData {
  niche: {
    id: string;
    name: string;
    description: string | null;
    language: string;
    accounts: NicheAccountRow[];
  } | null;
  hasActiveSession: boolean;
}

export function useNiche() {
  const [data, setData] = useState<NicheData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setData(await apiFetch<NicheData>("/api/niche"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  return { data, loading, refresh };
}
