"use client";

import { format } from "date-fns";
import { Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ACTIVE_STAGES, PIPELINE_STEPS, STAGE_LABELS, type Reel } from "../lib/reel";

export function ReelStageBadge({ reel }: { reel: Reel }) {
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
      {reel.running && <Loader2 className="size-3 animate-spin" />} {label}
    </Badge>
  );
}

/** Compact progress through the pipeline steps. */
export function ReelSteps({ reel }: { reel: Reel }) {
  const current = PIPELINE_STEPS.findIndex((s) => s.stage === reel.stage);
  const done = reel.stage === "READY" || reel.stage === "POSTED";
  return (
    <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {PIPELINE_STEPS.map((step, i) => {
        const complete = done || (current >= 0 && i < current);
        const now = ACTIVE_STAGES.has(reel.stage) && i === current;
        return (
          <li
            key={step.stage}
            className={cn(
              "flex items-center gap-1",
              complete ? "text-foreground" : now ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {complete ? (
              <Check className="size-3 text-emerald-500" />
            ) : now && reel.running ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <span className="size-3 text-center leading-3">·</span>
            )}
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}
