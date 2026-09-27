"use client";

import useSWR from "swr";
import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import type { EventWithTarget } from "@/types/domain";
import { EVENTS_KEY } from "@/lib/swr-keys";

export { EVENTS_KEY };

type EventsPage = { events: EventWithTarget[]; nextCursor: string | null };

export function useEvents() {
  // Pages beyond the first are appended client-side; SWR only caches page 1
  // (shared with anything else that reads /api/events, e.g. the dashboard).
  const { data, error, isLoading, mutate } = useSWR<EventsPage>(EVENTS_KEY);
  const [extra, setExtra] = useState<EventWithTarget[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorInitialized, setCursorInitialized] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  // First page's cursor arrives async; seed our "more pages" cursor once.
  if (data && cursorInitialized === undefined) {
    setCursorInitialized(data.nextCursor);
    setNextCursor(data.nextCursor);
  }

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<EventsPage>(`/api/events?cursor=${nextCursor}`);
      setExtra((prev) => [...prev, ...page.events]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  const refresh = useCallback(async () => {
    setExtra([]);
    setCursorInitialized(undefined);
    await mutate();
  }, [mutate]);

  return {
    events: data ? [...data.events, ...extra] : null,
    loading: isLoading,
    loadingMore,
    error: error instanceof Error ? error.message : error ? "Failed to load events." : null,
    refresh,
    loadMore,
    hasMore: Boolean(nextCursor),
  };
}
