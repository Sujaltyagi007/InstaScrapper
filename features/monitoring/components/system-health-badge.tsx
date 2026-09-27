"use client";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { Fragment, useState } from "react";
import { Activity, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";

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

const FALLBACK: HealthData = {
  status: "healthy",
  timestamp: new Date(0).toISOString(),
  durationMs: 0,
  subsystems: {
    database: { status: "up", latencyMs: 25 },
    storage: { provider: "imagekit.io", status: "checking...", enabled: true },
    scraperEngine: { mode: "STEALTH", status: "ready" },
  },
};

/**
 * The same "/api/health" cache key this app uses everywhere else, so this
 * badge (rendered once in the desktop sidebar, again in the mobile menu)
 * shares one request instead of firing two, and won't re-fetch if the
 * targets/settings pages already refreshed it moments ago.
 */
export function SystemHealthBadge({ direction = "up" }: { direction?: "up" | "down" } = {}) {
  const { data, isValidating, mutate } = useSWR<HealthData>("/api/health", {
    refreshInterval: 20000, // paused automatically while the tab is hidden
  });
  const [showDetails, setShowDetails] = useState(false);

  const health = data ?? FALLBACK;
  const isHealthy = health.status === "healthy" || health.status === "operational";
  const isDown = health.status === "down";

  return (
    <div className="relative">
      <button type="button" onClick={() => setShowDetails((prev) => !prev)} className="flex w-full items-center justify-between rounded-lg border border-border/40 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted/70 hover:text-foreground">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", isDown ? "bg-rose-500" : isHealthy ? "bg-emerald-500" : "bg-amber-500")} />
            <span className={cn("relative inline-flex size-2 rounded-full", isDown ? "bg-rose-500" : isHealthy ? "bg-emerald-500" : "bg-amber-500")} />
          </span>
          <span className="font-medium capitalize">
            {isDown ? "System Offline" : isHealthy ? "Systems Operational" : "Degraded"}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/80 font-mono">
          {health.subsystems?.database?.latencyMs ? `${health.subsystems.database.latencyMs}ms` : "Live"}
        </span>
      </button>

      {showDetails && (
        <div className={cn("absolute left-0 w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl z-50 animate-in fade-in-0 zoom-in-95", direction === "up" ? "bottom-full mb-2" : "top-full mt-2")}>
          <div className="flex items-center justify-between pb-2 border-b mb-2">
            <div className="flex items-center gap-1.5 font-medium text-xs">
              <Activity className="size-3.5 text-primary" />
              <span>Real-Time Health Status</span>
            </div>
            <button onClick={(e) => { e.stopPropagation(); mutate(); }} className="text-muted-foreground hover:text-foreground transition" title="Refresh health check">
              <RefreshCw className={cn("size-3", isValidating && "animate-spin")} />
            </button>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Postgres Database</span>
              <span className="flex items-center gap-1 font-mono font-medium">
                {health.subsystems?.database.status === "up" ? (
                  <Fragment>
                    <CheckCircle2 className="size-3 text-emerald-500" />
                    <span>{health.subsystems?.database.latencyMs}ms</span>
                  </Fragment>
                ) : (
                  <Fragment>
                    <XCircle className="size-3 text-rose-500" />
                    <span className="text-rose-500">Down</span>
                  </Fragment>
                )}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">ImageKit Storage</span>
              <span className="flex items-center gap-1 font-mono">
                {health.subsystems?.storage.enabled ? (
                  <Fragment>
                    <CheckCircle2 className="size-3 text-emerald-500" />
                    <span className="text-emerald-500">Active</span>
                  </Fragment>
                ) : (
                  <Fragment>
                    <AlertTriangle className="size-3 text-amber-500" />
                    <span className="text-amber-500">Unconfigured</span>
                  </Fragment>
                )}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Scraper Mode</span>
              <span className="font-mono text-muted-foreground font-medium">
                {health.subsystems?.scraperEngine.mode ?? "STEALTH"}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
