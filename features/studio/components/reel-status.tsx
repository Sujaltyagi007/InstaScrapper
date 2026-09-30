"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Check, Circle, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ACTIVE_STAGES, PIPELINE_STEPS, STAGE_LABELS, type Reel } from "../lib/reel";

function elapsedLabel(totalSeconds: number): string {
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${Math.floor(totalSeconds / 60)}:${String(seconds).padStart(2, "0")}`;
}

export function ReelElapsedTimer({ reel, retryQueued = false }: { reel: Reel; retryQueued?: boolean }) {
  const active = ACTIVE_STAGES.has(reel.stage) || retryQueued;
  const [now, setNow] = useState(() => Date.parse(reel.createdAt));

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (reel.stage === "POSTED") return null;
  const startedAt = Date.parse(reel.createdAt);
  const lastUpdate = Date.parse(reel.updatedAt ?? reel.createdAt);
  const endAt = active ? Math.max(now, lastUpdate) : lastUpdate;
  const totalSeconds = Number.isFinite(startedAt) && Number.isFinite(endAt)
    ? Math.max(0, Math.floor((endAt - startedAt) / 1000))
    : 0;
  const elapsed = elapsedLabel(totalSeconds);
  const label = `${active ? "Elapsed" : reel.stage === "FAILED" ? "Stopped after" : "Created in"} ${elapsed}`;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground"
      aria-label={label}
      title={label}
    >
      <Timer className={cn("size-3", active && "text-primary")} aria-hidden="true" />
      <span>{active ? "Elapsed" : reel.stage === "FAILED" ? "Stopped" : "Created"}</span>
      <time className="font-mono font-medium text-foreground">{elapsed}</time>
    </span>
  );
}

export function ReelStageBadge({ reel, retryQueued = false }: { reel: Reel; retryQueued?: boolean }) {
  if (retryQueued) {
    const targetStage = reel.stage === "FAILED" ? reel.failedStage ?? "SCRIPT" : reel.stage;
    const label = reel.running ? STAGE_LABELS[targetStage] ?? targetStage : `Starting ${STAGE_LABELS[targetStage] ?? targetStage}`;
    return (
      <Badge variant="secondary" className="gap-1.5">
        <Circle className="size-2 fill-primary text-primary animate-pulse" aria-hidden="true" />
        {label}
      </Badge>
    );
  }
  if (ACTIVE_STAGES.has(reel.stage) && reel.error && !reel.running) {
    return <Badge variant="warning">Retry scheduled</Badge>;
  }
  if (reel.stage === "FAILED") return <Badge variant="destructive">{STAGE_LABELS.FAILED}</Badge>;
  if (reel.stage === "POSTED") return <Badge variant="success">Posted</Badge>;
  if (reel.stage === "READY") {
    if (reel.sentAt) return <Badge variant="success">Sent to phone</Badge>;
    if (reel.scheduledFor)
      return <Badge variant="warning">Sends {format(new Date(reel.scheduledFor), "EEE HH:mm")}</Badge>;
    return <Badge variant="success">Ready</Badge>;
  }
  const label = STAGE_LABELS[reel.stage] ?? reel.stage;
  return (
    <Badge variant="secondary" className="gap-1">
      {reel.running && <Circle className="size-2 fill-primary text-primary animate-pulse" />} {label}
    </Badge>
  );
}

/** Slim, labeled progress rail through the video pipeline. */
export function ReelSteps({ reel, retryQueued = false }: { reel: Reel; retryQueued?: boolean }) {
  const stage = retryQueued && reel.stage === "FAILED" ? reel.failedStage ?? "SCRIPT" : reel.stage;
  const current = PIPELINE_STEPS.findIndex((s) => s.stage === stage);
  const done = reel.stage === "READY" || reel.stage === "POSTED";
  const currentLabel = current >= 0
    ? PIPELINE_STEPS[current].label
    : stage === "READY" ? "Ready to review" : STAGE_LABELS[stage] ?? stage;
  const working = reel.running || retryQueued;
  return (
    <div className="flex flex-col gap-2" aria-label="Video creation progress" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
          {working && <Circle className="size-2 shrink-0 animate-pulse fill-primary text-primary" aria-hidden="true" />}
          <span className="truncate">{retryQueued && !reel.running ? `Starting ${currentLabel}` : currentLabel}</span>
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {done ? "Complete" : current >= 0 ? `Step ${current + 1} of ${PIPELINE_STEPS.length}` : "Needs attention"}
        </span>
      </div>
      <ol className="grid grid-cols-7 gap-1.5" aria-label="Production stages">
        {PIPELINE_STEPS.map((step, i) => {
          const complete = done || (current >= 0 && i < current);
          const now = (ACTIVE_STAGES.has(stage) || retryQueued) && i === current;
          return (
            <li key={step.stage} aria-current={now ? "step" : undefined} title={step.label}>
              <div className="relative h-1 overflow-hidden rounded-full bg-muted">
                {complete && <span className="absolute inset-0 rounded-full bg-emerald-500" />}
                {now && (
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 w-2/5 overflow-hidden rounded-full bg-primary/25",
                      working && "reel-progress-sweep",
                    )}
                  >
                    {working && <span className="absolute inset-0 rounded-full bg-primary" />}
                  </span>
                )}
              </div>
              <span className="sr-only">{step.label}: {complete ? "complete" : now ? "in progress" : "up next"}</span>
              <span className="mt-1 hidden truncate text-[10px] text-muted-foreground sm:block">{step.label}</span>
              {complete && <Check className="sr-only" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
