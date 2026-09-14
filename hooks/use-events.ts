"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import type { EventWithTarget } from "@/types/domain";

export function useEvents() {
  const [events, setEvents] = useState<EventWithTarget[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ events: EventWithTarget[]; nextCursor: string | null }>("/api/events");
      setEvents(data.events);
      setNextCursor(data.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await apiFetch<{ events: EventWithTarget[]; nextCursor: string | null }>(
        `/api/events?cursor=${nextCursor}`
      );
      setEvents((prev) => [...(prev ?? []), ...data.events]);
      setNextCursor(data.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { events, loading, loadingMore, error, refresh, loadMore, hasMore: Boolean(nextCursor) };
}
