"use client";
import { apiFetch } from "@/lib/fetcher";
import type { JobWithTarget } from "@/types/domain";
import { useCallback, useEffect, useState } from "react";

export function useJobs() {
  const [jobs, setJobs] = useState<JobWithTarget[] | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ jobs: JobWithTarget[] }>("/api/jobs");
      setJobs(data.jobs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { jobs, loading, refresh };
}
