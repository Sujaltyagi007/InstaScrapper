"use client";
import { useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/fetcher";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/friendly-error";
import Link from "next/link";
import type { NichePostRow } from "../hooks/use-niche";
import { ExternalLink, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function dateInputValue(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

function ManualMetricsRow({ post, onSaved }: { post: NichePostRow; onSaved: () => void }) {
  const [views, setViews] = useState(post.playCount?.toString() ?? "");
  const [likes, setLikes] = useState(post.likeCount?.toString() ?? "");
  const [comments, setComments] = useState(post.commentCount?.toString() ?? "");
  const [postedAt, setPostedAt] = useState(dateInputValue(post.timestamp));
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/niche/metrics", {
        method: "POST",
        body: JSON.stringify({
          mediaId: post.id,
          playCount: views.trim() === "" ? null : Number(views),
          likeCount: Number(likes),
          commentCount: Number(comments),
          postedAt,
        }),
      });
      toast.success(`Metrics saved for @${post.target.username}.`);
      onSaved();
    } catch (error) {
      toast.error(friendlyError(error, "Could not save post metrics."));
    } finally {
      setSaving(false);
    }
  }

  const caption = post.caption?.replace(/\s+/g, " ").trim();
  const hasViews = post.mediaType === "REEL" || post.mediaType === "VIDEO";

  return (
    <li className="flex flex-col gap-3 p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">@{post.target.username} <span className="text-muted-foreground">· {post.mediaType.toLowerCase()}</span></p>
          <p className="truncate text-xs text-muted-foreground">{caption || "No caption"}</p>
        </div>
        {post.permalink ? (
          <a href={post.permalink} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-primary underline-offset-4 hover:underline">
            Open on Instagram <ExternalLink className="size-3" />
          </a>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">Link unavailable</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:max-w-2xl">
        {[
          { label: "Views", value: post.playCount },
          { label: "Likes", value: post.likeCount },
          { label: "Comments", value: post.commentCount },
        ].map(({ label, value }) => (
          <div key={label} className="min-w-0 rounded-md border bg-muted/30 px-3 py-2">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="truncate text-sm font-semibold tabular-nums">
              {value === null ? "—" : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)}
            </p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Posted {post.timestamp ? new Date(post.timestamp).toISOString().slice(0, 10) : "date unavailable"}</span>
        <span>
          {post.metricsUpdatedAt
            ? `Metrics updated ${new Date(post.metricsUpdatedAt).toISOString().slice(0, 10)}`
            : "Waiting for an automatic metrics sync"}
        </span>
      </div>
      <details className="group border-t pt-2">
        <summary className="w-fit cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Enter or correct metrics manually
        </summary>
        <form onSubmit={save} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${post.id}-views`} className="text-[11px] text-muted-foreground">
              {hasViews ? "Views" : "Views (optional)"}
            </Label>
            <Input id={`${post.id}-views`} type="number" min="0" max="2147483647" step="1" required={hasViews} value={views} onChange={(event) => setViews(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${post.id}-likes`} className="text-[11px] text-muted-foreground">Likes</Label>
            <Input id={`${post.id}-likes`} type="number" min="0" max="2147483647" step="1" required value={likes} onChange={(event) => setLikes(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${post.id}-comments`} className="text-[11px] text-muted-foreground">Comments</Label>
            <Input id={`${post.id}-comments`} type="number" min="0" max="2147483647" step="1" required value={comments} onChange={(event) => setComments(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${post.id}-posted-at`} className="text-[11px] text-muted-foreground">Date posted</Label>
            <Input id={`${post.id}-posted-at`} type="date" required value={postedAt} onChange={(event) => setPostedAt(event.target.value)} />
          </div>
          <Button type="submit" variant="outline" className="self-end" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
        </form>
      </details>
    </li>
  );
}

export function ManualMetricsCard({
  posts,
  onSaved,
  automaticMetricsAvailable,
}: {
  posts: NichePostRow[];
  onSaved: () => void;
  automaticMetricsAvailable: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Niche post metrics</CardTitle>
        <CardDescription>
          {automaticMetricsAvailable
            ? "Counts sync during scheduled official Meta checks for supported public accounts. View counts can include paid and organic views."
            : "Live metrics are not connected yet. Counts and sync status are shown here; manual correction is available per post."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {!automaticMetricsAvailable && (
            <p className="text-sm text-muted-foreground">
              Connect the official Meta Graph API in <Link href="/settings" className="underline underline-offset-4">Settings</Link> to sync supported accounts automatically. Only public Business/Creator targets are eligible; no Instagram login session is used for trend checks.
            </p>
          )}
          {posts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Posts will appear here after a niche account has been checked.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border">
              {posts.map((post) => <ManualMetricsRow key={post.id} post={post} onSaved={onSaved} />)}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}