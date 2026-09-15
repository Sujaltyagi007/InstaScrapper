import { apiFetch } from "@/lib/fetcher";
import type { TargetWithMonitor, TargetDetail } from "@/types/domain";

export const getTargets = async () => {
  return apiFetch<{ targets: TargetWithMonitor[] }>("/api/targets");
};

export const getTargetById = async (id: string) => {
  return apiFetch<{ target: TargetDetail }>(`/api/targets/${id}`);
};
