"use client";
import { apiFetch } from "@/lib/fetcher";
import { useCallback, useEffect, useState } from "react";

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
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ user: UserSettings }>("/api/settings");
      setSettings(data.user);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { settings, loading, refresh };
}
