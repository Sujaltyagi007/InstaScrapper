"use client";

import { useEffect, useState, useTransition } from "react";
import { Activity, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface HealthData {
  status: "healthy" | "operational" | "degraded" | "down";
  timestamp: string;
  durationMs: number;
  subsystems?: {
    database: { status: "up" | "down"; latencyMs: number; error?: string | null };
    storage: { provider: string; status: string; enabled: boolean };
    scraperEngine: { mode: string; status: string };
    backgroundWorker?: { lastJobAt: string | null; lastJobStatus: string | null };
  };
}

export function SystemHealthBadge() {
  // Optimistic initial state: assumes healthy immediately to avoid layout flicker
  const [data, setData] = useState<HealthData>({
    status: "healthy",
    timestamp: new Date().toISOString(),
    durationMs: 0,
    subsystems: {
      database: { status: "up", latencyMs: 25 },
      storage: { provider: "imagekit.io", status: "checking...", enabled: true },
      scraperEngine: { mode: "STEALTH", status: "ready" },
    },
  });
  const [isPending, startTransition] = useTransition();
  const [showDetails, setShowDetails] = useState(false);

  const checkHealth = async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) {
        setData((prev) => ({ ...prev, status: "degraded" }));
        return;
      }
      const json: HealthData = await res.json();
      startTransition(() => {
        setData(json);
      });
    } catch {
      startTransition(() => {
        setData((prev) => ({ ...prev, status: "down" }));
      });
    }
  };

  useEffect(() => {
    // Initial real check after component mount
    checkHealth();

    // Polling interval: every 20 seconds, only when tab is visible
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        checkHealth();
      }
    }, 20000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        checkHealth();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const isHealthy = data.status === "healthy" || data.status === "operational";
  const isDown = data.status === "down";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowDetails((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-lg border border-border/40 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted/70 hover:text-foreground"
      >
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span
              className={cn(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                isDown
                  ? "bg-rose-500"
                  : isHealthy
                  ? "bg-emerald-500"
                  : "bg-amber-500"
              )}
            />
            <span
              className={cn(
                "relative inline-flex size-2 rounded-full",
                isDown
                  ? "bg-rose-500"
                  : isHealthy
                  ? "bg-emerald-500"
                  : "bg-amber-500"
              )}
            />
          </span>
          <span className="font-medium capitalize">
            {isDown ? "System Offline" : isHealthy ? "Systems Operational" : "Degraded"}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/80 font-mono">
          {data.subsystems?.database?.latencyMs ? `${data.subsystems.database.latencyMs}ms` : "Live"}
        </span>
      </button>

      {showDetails && (
        <div className="absolute bottom-full left-0 mb-2 w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl z-50 animate-in fade-in-0 zoom-in-95">
          <div className="flex items-center justify-between pb-2 border-b mb-2">
            <div className="flex items-center gap-1.5 font-medium text-xs">
              <Activity className="size-3.5 text-primary" />
              <span>Real-Time Health Status</span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                checkHealth();
              }}
              className="text-muted-foreground hover:text-foreground transition"
              title="Refresh health check"
            >
              <RefreshCw className={cn("size-3", isPending && "animate-spin")} />
            </button>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Postgres Database</span>
              <span className="flex items-center gap-1 font-mono font-medium">
                {data.subsystems?.database.status === "up" ? (
                  <>
                    <CheckCircle2 className="size-3 text-emerald-500" />
                    <span>{data.subsystems?.database.latencyMs}ms</span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-3 text-rose-500" />
                    <span className="text-rose-500">Down</span>
                  </>
                )}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">ImageKit Storage</span>
              <span className="flex items-center gap-1 font-mono">
                {data.subsystems?.storage.enabled ? (
                  <>
                    <CheckCircle2 className="size-3 text-emerald-500" />
                    <span className="text-emerald-500">Active</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="size-3 text-amber-500" />
                    <span className="text-amber-500">Unconfigured</span>
                  </>
                )}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Scraper Mode</span>
              <span className="font-mono text-muted-foreground font-medium">
                {data.subsystems?.scraperEngine.mode ?? "STEALTH"}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
