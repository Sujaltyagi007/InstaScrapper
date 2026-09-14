"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import type { NotificationChannelSummary } from "@/types/domain";

export function useNotificationChannels() {
  const [channels, setChannels] = useState<NotificationChannelSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ channels: NotificationChannelSummary[] }>("/api/notification-channels");
      setChannels(data.channels);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notification channels.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { channels, loading, error, refresh };
}
