"use client";
import useSWR from "swr";
import { useCallback } from "react";
import { SETTINGS_KEY } from "@/lib/swr-keys";
import { friendlyError } from "@/lib/friendly-error";

export interface UserSettings {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
  retentionDays: number;
  sleepEnabled: boolean;
  sleepStartHour: number;
  sleepEndHour: number;
}

export function useSettings() {
  const { data, error, isLoading, mutate } = useSWR<{ user: UserSettings }>(SETTINGS_KEY);
  const refresh = useCallback(() => mutate(), [mutate]);
  return { settings: data?.user ?? null, loading: isLoading, error: error ? friendlyError(error) : null, refresh };
}
