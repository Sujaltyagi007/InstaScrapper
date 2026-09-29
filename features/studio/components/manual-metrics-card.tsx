"use client";
import { useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/fetcher";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/friendly-error";
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
          <a
            href={post.permalink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
          >
            Open on Instagram <ExternalLink className="size-3" />
          </a>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">Link unavailable</span>
        )}
      </div>
      <form onSubmit={save} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
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
    </li>
  );
}

export function ManualMetricsCard({ posts, onSaved }: { posts: NichePostRow[]; onSaved: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Niche post metrics</CardTitle>
        <CardDescription>The 15 most recently collected posts. Enter the counts and posted date shown on Instagram; saved metrics feed directly into trend scoring.</CardDescription>
      </CardHeader>
      <CardContent>
        {posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Posts will appear here after a niche account has been checked.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {posts.map((post) => <ManualMetricsRow key={post.id} post={post} onSaved={onSaved} />)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}