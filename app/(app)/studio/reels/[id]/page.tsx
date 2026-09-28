"use client";
import { friendlyError } from "@/lib/friendly-error";

import useSWR from "swr";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { apiFetch, FetchError } from "@/lib/fetcher";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/error-state";
import { CardSkeleton } from "@/components/common/page-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACTIVE_STAGES, STAGE_LABELS, fullCaption, type Reel } from "@/features/studio/lib/reel";
import { useReelAutorun } from "@/features/studio/hooks/use-reel-autorun";
import { ReelStageBadge, ReelSteps } from "@/features/studio/components/reel-status";

const POLL_MS = 6_000;

export default function ReelPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [postedUrl, setPostedUrl] = useState("");

  // Polls while the reel is still being made; SWR pauses it while the tab is hidden.
  const { data, error, mutate } = useSWR<{ reel: Reel }>(`/api/reels/${id}`, {
    refreshInterval: (latest) => (latest && ACTIVE_STAGES.has(latest.reel.stage) ? POLL_MS : 0),
  });
  const reel = data?.reel ?? null;
  const missing = error instanceof FetchError && error.status === 404;
  const loadError = error && !missing ? friendlyError(error) : null;
  const refresh = useCallback(() => mutate(), [mutate]);
  const refreshQuietly = useCallback(() => {
    mutate().catch(() => {});
  }, [mutate]);
  const active = reel ? ACTIVE_STAGES.has(reel.stage) : false;
  const reelList = useMemo(() => (reel ? [reel] : null), [reel]);
  useReelAutorun(reelList, refreshQuietly);

  async function run(label: string, action: () => Promise<string | void>) {
    setBusy(label);
    try {
      const message = await action();
      if (message) toast.success(message);
      await refresh();
    } catch (err) {
      toast.error(friendlyError(err, "Something went wrong."));
    } finally {
      setBusy(null);
    }
  }

  const post = (path: string, body?: unknown) =>
    apiFetch(`/api/reels/${id}${path}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

  async function copyCaption() {
    if (!reel) return;
    try {
      await navigator.clipboard.writeText(fullCaption(reel));
      toast.success("Caption copied.");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  }

  if (missing || (!reel && loadError)) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <Link href="/studio" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="size-4" /> Studio
        </Link>
        {missing ? (
          <ErrorState title="This reel isn't here anymore" message="It may have been deleted. Your other reels are in Studio." />
        ) : (
          <ErrorState title="Couldn't load this reel" message={loadError} onRetry={refresh} />
        )}
      </div>
    );
  }
  if (!reel) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4" aria-busy="true" aria-label="Loading reel">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-7 w-2/3" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-10 rounded-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,240px)_1fr]">
          <Skeleton className="aspect-9/16 w-full rounded-xl" />
          <CardSkeleton rows={4} />
        </div>
      </div>
    );
  }

  const finished = reel.stage === "READY" || reel.stage === "POSTED";
  const locked = reel.running || busy !== null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/studio" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="size-4" /> Studio
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{reel.idea.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <ReelStageBadge reel={reel} />
          {reel.voiceTiming && <span>{reel.voiceTiming.durationSec.toFixed(0)}s</span>}
          {reel.sentAt && <span>sent {format(new Date(reel.sentAt), "EEE d MMM, HH:mm")}</span>}
          {reel.postedAt && <span>posted {format(new Date(reel.postedAt), "EEE d MMM")}</span>}
        </div>
      </div>

      {!finished && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <ReelSteps reel={reel} />
            {reel.error && (
              <p className="text-sm text-destructive">
                {reel.stage === "FAILED"
                  ? `Stopped at "${STAGE_LABELS[reel.failedStage ?? ""] ?? reel.failedStage}": `
                  : ""}
                {reel.error}
              </p>
            )}
            {(reel.stage === "FAILED" || reel.error) && (
              <Button
                variant="outline"
                className="w-fit"
                disabled={locked}
                onClick={() => run("retry", () => post("/retry").then(() => "Retrying."))}
              >
                <RotateCcw /> Retry
              </Button>
            )}
            {active && !reel.error && (
              <p className="text-sm text-muted-foreground">
                Working on it. This page updates by itself; the whole reel usually takes a few minutes.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {finished && (
        <div className="grid gap-6 md:grid-cols-[minmax(0,320px)_1fr]">
          <div className="flex flex-col gap-3">
            {reel.renderUrl ? (
              <video
                src={reel.renderUrl}
                poster={reel.coverUrl ?? undefined}
                controls
                playsInline
                preload="metadata"
                className="aspect-9/16 w-full rounded-lg bg-black"
              />
            ) : (
              <p className="text-sm text-muted-foreground">The video was removed a few days after posting.</p>
            )}
            {reel.downloadUrl && (
              <Button variant="outline" asChild>
                <a href={`/api/reels/${id}/download`}>
                  <Download /> Download video
                </a>
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Caption</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="whitespace-pre-wrap text-sm">{fullCaption(reel)}</p>
                <Button variant="outline" className="w-fit" onClick={copyCaption}>
                  <Copy /> Copy caption
                </Button>
              </CardContent>
            </Card>

            {reel.stage === "READY" && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Send to phone</CardTitle>
                  <CardDescription>
                    Sends the video and caption to your ntfy app. &quot;Best time&quot; picks a random moment in the
                    next good window (around lunch or evening, your timezone), never during your sleep hours.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {reel.scheduledFor && !reel.sentAt && (
                    <p className="flex items-center gap-2 text-sm">
                      <Clock className="size-4" /> Scheduled for {format(new Date(reel.scheduledFor), "EEE d MMM, HH:mm")}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={locked}
                      onClick={() => run("send", () => post("/send", { mode: "now" }).then(() => "Sent to your phone."))}
                    >
                      {busy === "send" ? <Loader2 className="animate-spin" /> : <Send />} Send now
                    </Button>
                    <Button
                      variant="outline"
                      disabled={locked}
                      onClick={() =>
                        run("schedule", async () => {
                          const res = await apiFetch<{ scheduledFor: string }>(`/api/reels/${id}/send`, {
                            method: "POST",
                            body: JSON.stringify({ mode: "best" }),
                          });
                          return `Scheduled for ${format(new Date(res.scheduledFor), "EEE HH:mm")}.`;
                        })
                      }
                    >
                      <Clock /> {reel.scheduledFor && !reel.sentAt ? "Pick another time" : "Send at best time"}
                    </Button>
                    {reel.scheduledFor && !reel.sentAt && (
                      <Button
                        variant="ghost"
                        disabled={locked}
                        onClick={() =>
                          run("cancel", () =>
                            apiFetch(`/api/reels/${id}/send`, { method: "DELETE" }).then(() => "Schedule cancelled."),
                          )
                        }
                      >
                        <X /> Cancel
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {reel.stage === "READY" && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">After posting</CardTitle>
                  <CardDescription>
                    In Instagram: paste the caption and turn on the AI label (Advanced settings), since the voice is
                    AI-generated. If you add a trending sound, keep its volume low so the voice stays clear.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    placeholder="Reel link (optional)"
                    value={postedUrl}
                    onChange={(e) => setPostedUrl(e.target.value)}
                  />
                  <Button
                    disabled={locked}
                    onClick={() =>
                      run("posted", () => post("/posted", { url: postedUrl.trim() }).then(() => "Marked as posted."))
                    }
                  >
                    <Check /> Mark as posted
                  </Button>
                </CardContent>
              </Card>
            )}
            {reel.postedUrl && (
              <a
                href={reel.postedUrl}
                target="_blank"
                rel="noreferrer"
                className="flex w-fit items-center gap-1 text-sm hover:underline"
              >
                View on Instagram <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {reel.stage !== "POSTED" && (reel.script || finished) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Not quite right?</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {finished && (
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => run("caption", () => post("/regenerate", { from: "CAPTION" }).then(() => "Writing a new caption."))}
              >
                <Sparkles /> New caption
              </Button>
            )}
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => run("footage", () => post("/regenerate", { from: "VISUALS" }).then(() => "Finding new footage."))}
            >
              <RotateCcw /> New footage
            </Button>
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => {
                if (!confirm("Write a new script and redo everything? This uses more of Gemini's daily quota.")) return;
                run("restart", () => post("/regenerate", { from: "SCRIPT" }).then(() => "Starting over."));
              }}
            >
              <RotateCcw /> Start over
            </Button>
            <Button
              variant="ghost"
              disabled={locked}
              onClick={() => {
                if (!confirm("Delete this reel and its files? The idea goes back to your suggestions.")) return;
                run("delete", async () => {
                  await apiFetch(`/api/reels/${id}`, { method: "DELETE" });
                  router.push("/studio");
                  return "Reel deleted.";
                });
              }}
            >
              <Trash2 /> Delete
            </Button>
          </CardContent>
        </Card>
      )}

      {reel.script && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">How it was made</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              {reel.script.sentences.map((s, i) => {
                const clip = reel.clips?.find((c) => c.sentence === i)?.chosen;
                return (
                  <li key={i}>
                    {s.text}{" "}
                    <span className="text-xs text-muted-foreground">
                      [{s.visual}]
                      {clip && (
                        <>
                          {" · "}
                          <a href={clip.pageUrl} target="_blank" rel="noreferrer" className="hover:underline">
                            Pexels{clip.author ? `: ${clip.author}` : ""}
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="text-xs text-muted-foreground">
              Voice: {reel.script.voice} · {reel.script.voiceStyle}
            </p>
            {reel.audioBlueprint && (
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">
                    Trending sound feel ({reel.audioBlueprint.reference.basis === "listened" ? "heard" : "guessed"}):
                  </span>{" "}
                  {[
                    reel.audioBlueprint.reference.genre,
                    reel.audioBlueprint.reference.mood.join(", "),
                    reel.audioBlueprint.reference.bpm ? `${reel.audioBlueprint.reference.bpm} BPM` : null,
                    `${reel.audioBlueprint.reference.energy} energy`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p>
                  <span className="font-medium text-foreground">Music:</span>{" "}
                  {reel.audioBlueprint.music?.title ?? "none (add music to the sound bank)"} ·{" "}
                  <span className="font-medium text-foreground">Effects:</span>{" "}
                  {reel.audioBlueprint.sfx.length
                    ? reel.audioBlueprint.sfx.map((s) => `${s.title} @ ${s.atSec.toFixed(1)}s`).join(", ")
                    : "none"}
                </p>
              </div>
            )}
            {!finished && (reel.mixUrl || reel.voiceUrl) && (
              <audio controls preload="none" src={reel.mixUrl ?? reel.voiceUrl ?? undefined} className="h-8 w-full" />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
