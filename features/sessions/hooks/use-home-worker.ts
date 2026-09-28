"use client";
import useSWR from "swr";
import { useCallback } from "react";
import { apiFetch } from "@/lib/fetcher";
import { HOME_WORKER_DEVICES_KEY } from "@/lib/swr-keys";
import { friendlyError } from "@/lib/friendly-error";

export interface HomeWorkerDevice {
  id: string;
  label: string;
  status: "ACTIVE" | "REVOKED";
  lastSeenAt: string | null;
  createdAt: string;
}

export function useHomeWorkerDevices() {
  const { data, error, isLoading, mutate } = useSWR<{ devices: HomeWorkerDevice[] }>(HOME_WORKER_DEVICES_KEY);
  const refresh = useCallback(() => mutate(), [mutate]);

  const pair = useCallback(async (label: string) => {
    const res = await apiFetch<{ id: string; token: string }>("/api/worker/devices", {
      method: "POST",
      body: JSON.stringify({ label }),
    });
    await mutate();
    return res;
  }, [mutate]);

  const revoke = useCallback(async (id: string) => {
    await apiFetch(`/api/worker/devices/${id}`, { method: "DELETE" });
    await mutate();
  }, [mutate]);

  return {
    devices: data?.devices ?? null,
    loading: isLoading,
    error: error ? friendlyError(error) : null,
    refresh,
    pair,
    revoke,
  };
}
