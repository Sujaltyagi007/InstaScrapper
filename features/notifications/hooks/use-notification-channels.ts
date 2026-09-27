"use client";

import useSWR from "swr";
import { useCallback } from "react";
import { CHANNELS_KEY } from "@/lib/swr-keys";
import { friendlyError } from "@/lib/friendly-error";
import type { NotificationChannelSummary } from "@/types/domain";

export { CHANNELS_KEY };
export type ChannelsPayload = { channels: NotificationChannelSummary[] };

export function useNotificationChannels() {
  const { data, error, isLoading, mutate } = useSWR<ChannelsPayload>(CHANNELS_KEY);
  const refresh = useCallback(() => mutate(), [mutate]);
  return {
    channels: data?.channels ?? null,
    loading: isLoading,
    error: error ? friendlyError(error) : null,
    refresh,
    mutate,
  };
}
