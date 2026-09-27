"use client";

import { useState } from "react";
import { CloudOff, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  /** What failed, in the user's words: "Couldn't load your targets". */
  title?: string;
  /** Already user-friendly (from `friendlyError` / the hooks) — never a raw error. */
  message?: string | null;
  onRetry?: () => unknown;
  className?: string;
}

/** Compact, calm error box shown in place of content that failed to load. */
export function ErrorState({
  title = "Couldn't load this",
  message = "Something went wrong. Please try again.",
  onRetry,
  className,
}: ErrorStateProps) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    if (!onRetry) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center",
        className,
      )}
    >
      <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <CloudOff className="size-4" />
      </div>
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        {message && <p className="max-w-xs text-xs text-muted-foreground">{message}</p>}
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-1 h-7 text-xs" disabled={retrying} onClick={retry}>
          <RotateCw className={cn(retrying && "animate-spin")} /> Try again
        </Button>
      )}
    </div>
  );
}

/** One-line version for when stale data is still on screen and only a refresh failed. */
export function InlineRefreshError({ message, onRetry }: { message?: string | null; onRetry?: () => unknown }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300"
    >
      <CloudOff className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{message ?? "Couldn't refresh."} Showing the last loaded data.</span>
      {onRetry && (
        <button type="button" onClick={() => onRetry()} className="shrink-0 font-medium underline-offset-2 hover:underline">
          Retry
        </button>
      )}
    </div>
  );
}
