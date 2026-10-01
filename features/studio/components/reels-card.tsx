"use client";
import useSWR from "swr";
import { AppLink } from "@/features/shell/navigation";
import { toast } from "sonner";
import { apiFetch } from "@/lib/fetcher";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/friendly-error";
import { RetryReelDialog } from "./retry-reel-dialog";
import { useReelAutorun } from "../hooks/use-reel-autorun";
import { Film, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_STAGES, STAGE_LABELS, type Reel } from "../lib/reel";
import { ReelElapsedTimer, ReelStageBadge, ReelSteps } from "./reel-status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const POLL_MS = 8_000;

export function ReelsCard({ refreshKey }: { refreshKey: number }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [retryTarget, setRetryTarget] = useState<Reel | null>(null);
  const [retryQueuedId, setRetryQueuedId] = useState<string | null>(null);
  const retryBaseline = useRef<{ stage: string; attempts: number; error: string | null } | null>(null);
  // Keep polling while anything is still being worked on (SWR pauses it while the tab is hidden).
  const { data, mutate } = useSWR<{ reels: Reel[] }>("/api/reels", {
    refreshInterval: (latest: { reels: Reel[] } | undefined) => retryQueuedId
      ? 1500
      : latest?.reels?.some((r) => ACTIVE_STAGES.has(r.stage)) ? POLL_MS : 0,
    onSuccess: (latest) => {
      const baseline = retryBaseline.current;
      const current = latest.reels.find((reel) => reel.id === retryQueuedId);
      if (
        baseline && current &&
        (current.running || current.stage !== baseline.stage || current.attempts !== baseline.attempts || current.error !== baseline.error)
      ) {
        retryBaseline.current = null;
        setRetryQueuedId(null);
      }
    },
  });
  const reels = data?.reels ?? null;
  const refresh = useCallback(() => mutate(), [mutate]);
  const refreshQuietly = useCallback(() => {
    mutate().catch(() => {});
  }, [mutate]);

  // A newly approved idea (refreshKey bump) means a new reel exists: fetch now.
  useEffect(() => {
    if (refreshKey > 0) mutate().catch(() => {});
  }, [refreshKey, mutate]);
  useReelAutorun(reels, refreshQuietly);

  async function act(reel: Reel, action: "retry" | "delete") {
    setBusyId(reel.id);
    // Optimistic delete: the row goes at once; the re-fetch after restores it on failure.
    if (action === "delete") {
      mutate((cur) => cur && { reels: cur.reels.filter((r) => r.id !== reel.id) }, { revalidate: false });
    }
    try {
      if (action === "retry") {
        await apiFetch(`/api/reels/${reel.id}/retry`, { method: "POST" });
        const stage = reel.stage === "FAILED" ? reel.failedStage ?? "SCRIPT" : reel.stage;
        toast.success(`Retry accepted. Starting ${STAGE_LABELS[stage] ?? stage}.`);
        setRetryTarget(null);
      }
      else await apiFetch(`/api/reels/${reel.id}`, { method: "DELETE" });
      if (action === "delete") toast.success("Reel deleted. Its idea is back in the list.");
    } catch (err) {
      if (action === "retry") {
        retryBaseline.current = null;
        setRetryQueuedId(null);
      }
      toast.error(friendlyError(err, "Couldn't do that. Please try again."));
    } finally {
      await refresh();
      setBusyId(null);
    }
  }

  function confirmRetry() {
    if (!retryTarget) return;
    const stage = retryTarget.stage === "FAILED" ? retryTarget.failedStage ?? "SCRIPT" : retryTarget.stage;
    retryBaseline.current = {
      stage,
      attempts: retryTarget.stage === "FAILED" ? 0 : retryTarget.attempts,
      error: retryTarget.stage === "FAILED" ? null : retryTarget.error,
    };
    setRetryQueuedId(retryTarget.id);
    void act(retryTarget, "retry");
  }

  if (reels === null || reels.length === 0) return null;

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>Reels</CardTitle>
        <CardDescription>
          Approved ideas being made into reels. A reel takes a few minutes; it keeps going in the background once the
          scheduler is set up, and faster while this page is open.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {reels.map((reel) => (
            <li key={reel.id} className="flex gap-3 rounded-lg border p-3">
              <AppLink
                to={{ tab: "studio", reelId: reel.id }}
                className="flex aspect-9/16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
              >
                {reel.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={reel.coverUrl} alt="" className="size-full object-cover" />
                ) : (
                  <Film className="size-5 text-muted-foreground" />
                )}
              </AppLink>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <AppLink to={{ tab: "studio", reelId: reel.id }} className="font-medium hover:underline">
                      {reel.idea.title}
                    </AppLink>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <ReelStageBadge reel={reel} retryQueued={retryQueuedId === reel.id} />
                      <ReelElapsedTimer reel={reel} retryQueued={retryQueuedId === reel.id} />
                      {formatDistanceToNow(new Date(reel.createdAt), { addSuffix: true })}
                      {reel.voiceTiming ? ` · Voice ${reel.voiceTiming.durationSec.toFixed(0)}s` : ""}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {(reel.stage === "FAILED" || (reel.error && ACTIVE_STAGES.has(reel.stage))) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === reel.id || reel.running || retryQueuedId === reel.id}
                        onClick={() => setRetryTarget(reel)}
                      >
                        {busyId === reel.id || retryQueuedId === reel.id
                          ? <Loader2 className="animate-spin" />
                          : <RotateCcw />}
                        {retryQueuedId === reel.id ? "Starting…" : "Retry"}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" asChild>
                      <AppLink to={{ tab: "studio", reelId: reel.id }}>Open</AppLink>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === reel.id || reel.running}
                      onClick={() => act(reel, "delete")}
                      aria-label="Delete reel"
                    >
                      {busyId === reel.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    </Button>
                  </div>
                </div>
                {(ACTIVE_STAGES.has(reel.stage) || retryQueuedId === reel.id) && (
                  <ReelSteps reel={reel} retryQueued={retryQueuedId === reel.id} />
                )}
                {retryQueuedId === reel.id && (
                  <p className="flex items-center gap-2 text-xs text-primary" role="status">
                    <Loader2 className="size-3 animate-spin" /> Retry accepted. Waiting for the stage to start…
                  </p>
                )}
                {reel.error && (
                  <p className="text-xs text-destructive">
                    {reel.stage === "FAILED"
                      ? `Stopped at "${STAGE_LABELS[reel.failedStage ?? ""] ?? reel.failedStage}": `
                      : ""}
                    {reel.error}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
    <RetryReelDialog
      reel={retryTarget}
      open={Boolean(retryTarget)}
      onOpenChange={(open) => !open && setRetryTarget(null)}
      onConfirm={confirmRetry}
    />
    </>
  );
}
