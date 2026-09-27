"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Film, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACTIVE_STAGES, STAGE_LABELS, type Reel } from "../lib/reel";
import { useReelAutorun } from "../hooks/use-reel-autorun";
import { ReelStageBadge, ReelSteps } from "./reel-status";

const POLL_MS = 8_000;

export function ReelsCard({ refreshKey }: { refreshKey: number }) {
  const [reels, setReels] = useState<Reel[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await apiFetch<{ reels: Reel[] }>("/api/reels");
    setReels(res.reels);
  }, []);
  const refreshQuietly = useCallback(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    refresh().catch(() => setReels([]));
  }, [refresh, refreshKey]);

  // Keep polling while anything is still being worked on.
  const active = reels?.some((r) => ACTIVE_STAGES.has(r.stage)) ?? false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refreshQuietly, POLL_MS);
    return () => clearInterval(timer);
  }, [active, refreshQuietly]);
  useReelAutorun(reels, refreshQuietly);

  async function act(reel: Reel, action: "retry" | "delete") {
    setBusyId(reel.id);
    try {
      if (action === "retry") await apiFetch(`/api/reels/${reel.id}/retry`, { method: "POST" });
      else await apiFetch(`/api/reels/${reel.id}`, { method: "DELETE" });
      if (action === "delete") toast.success("Reel deleted. Its idea is back in the list.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  if (reels === null || reels.length === 0) return null;

  return (
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
              <Link
                href={`/studio/reels/${reel.id}`}
                className="flex aspect-9/16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
              >
                {reel.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={reel.coverUrl} alt="" className="size-full object-cover" />
                ) : (
                  <Film className="size-5 text-muted-foreground" />
                )}
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link href={`/studio/reels/${reel.id}`} className="font-medium hover:underline">
                      {reel.idea.title}
                    </Link>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <ReelStageBadge reel={reel} />
                      {formatDistanceToNow(new Date(reel.createdAt), { addSuffix: true })}
                      {reel.voiceTiming ? ` · ${reel.voiceTiming.durationSec.toFixed(0)}s` : ""}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {(reel.stage === "FAILED" || (reel.error && ACTIVE_STAGES.has(reel.stage))) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === reel.id || reel.running}
                        onClick={() => act(reel, "retry")}
                      >
                        <RotateCcw /> Retry
                      </Button>
                    )}
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/studio/reels/${reel.id}`}>Open</Link>
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
                {ACTIVE_STAGES.has(reel.stage) && <ReelSteps reel={reel} />}
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
  );
}
