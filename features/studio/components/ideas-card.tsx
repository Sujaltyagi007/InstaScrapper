"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Check, ExternalLink, Loader2, Sparkles, X } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface IdeaSource {
  id: string;
  username: string;
  permalink: string | null;
  mediaType: string;
  playCount: number | null;
  likeCount: number | null;
  timestamp: string | null;
}

interface Idea {
  id: string;
  title: string;
  angle: string;
  hook: string;
  whyTrending: string;
  status: "SUGGESTED" | "APPROVED";
  createdAt: string;
  sources: IdeaSource[];
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function sourceStat(s: IdeaSource): string {
  if (s.playCount) return `${compact(s.playCount)} views`;
  if (s.likeCount) return `${compact(s.likeCount)} likes`;
  return s.mediaType.toLowerCase();
}

export function IdeasCard({ onApproved }: { onApproved?: () => void }) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await apiFetch<{ ideas: Idea[] }>("/api/ideas");
    setIdeas(res.ideas);
  }, []);

  useEffect(() => {
    refresh().catch(() => setIdeas([]));
  }, [refresh]);

  async function generate() {
    setGenerating(true);
    try {
      const res = await apiFetch<{ created: number; candidatesConsidered: number }>("/api/ideas/generate", {
        method: "POST",
      });
      toast.success(`${res.created} new idea${res.created === 1 ? "" : "s"} from ${res.candidatesConsidered} trending posts.`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to find ideas.");
    } finally {
      setGenerating(false);
    }
  }

  async function setStatus(id: string, status: "APPROVED" | "DISMISSED") {
    setBusyId(id);
    try {
      await apiFetch(`/api/ideas/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      if (status === "APPROVED") toast.success("Approved. Writing the script and voiceover now.");
      await refresh();
      if (status === "APPROVED") onApproved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update idea.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trending ideas</CardTitle>
        <CardDescription>
          Reels in your niche that are beating their account&apos;s usual numbers, turned into original ideas for you.
          Approve the ones you want made.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button className="w-fit" onClick={generate} disabled={generating}>
          {generating ? <Loader2 className="animate-spin" /> : <Sparkles />} Find trending ideas
        </Button>

        {ideas === null ? null : ideas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ideas yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {ideas.map((idea) => (
              <li key={idea.id} className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2 font-medium">
                      {idea.title}
                      {idea.status === "APPROVED" && <Badge>Approved</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(idea.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  {idea.status === "SUGGESTED" && (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busyId === idea.id} onClick={() => setStatus(idea.id, "APPROVED")}>
                        <Check /> Approve &amp; make reel
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === idea.id}
                        onClick={() => setStatus(idea.id, "DISMISSED")}
                      >
                        <X /> Dismiss
                      </Button>
                    </div>
                  )}
                </div>

                <p className="text-sm">
                  <span className="font-medium">Hook:</span> “{idea.hook}”
                </p>
                <p className="text-sm text-muted-foreground">{idea.angle}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Why it&apos;s trending:</span> {idea.whyTrending}
                </p>

                {idea.sources.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {idea.sources.map((s) =>
                      s.permalink ? (
                        <a
                          key={s.id}
                          href={s.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                        >
                          @{s.username} · {sourceStat(s)} <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span key={s.id} className="rounded-md border px-2 py-1 text-xs">
                          @{s.username} · {sourceStat(s)}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
