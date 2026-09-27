"use client";
import useSWR from "swr";
import { apiFetch } from "@/lib/fetcher";
import { EVENTS_KEY } from "@/lib/swr-keys";
import { useCallback, useState } from "react";
import type { EventWithTarget } from "@/types/domain";
import { friendlyError } from "@/lib/friendly-error";

export { EVENTS_KEY };

type EventsPage = { events: EventWithTarget[]; nextCursor: string | null };

export function useEvents() {
  const { data, error, isLoading, mutate } = useSWR<EventsPage>(EVENTS_KEY);
  const [extra, setExtra] = useState<EventWithTarget[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorInitialized, setCursorInitialized] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

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
    error: error ? friendlyError(error) : null,
    refresh,
    loadMore,
    hasMore: Boolean(nextCursor),
  };
}
