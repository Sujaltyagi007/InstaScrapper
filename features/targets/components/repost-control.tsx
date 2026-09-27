"use client";

import { useEffect, useState } from "react";
import { Loader2, Send, CheckCircle2, Link2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, FetchError } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { Media } from "@prisma/client";

interface MetaStatus {
  configured: boolean;
  connection: { status: string; igUsername: string | null } | null;
}

/**
 * "Repost to my Instagram" for one media item, via the **official** Graph API
 * Content Publishing flow. There's no account picker any more: it posts to the
 * single Instagram professional account connected in Settings.
 *
 * Note the honest caveat in the UI — the official API makes the *posting*
 * sanctioned, but it doesn't grant rights to someone else's content.
 */
export function RepostControl({ media }: { media: Media }) {
  const [meta, setMeta] = useState<MetaStatus | null>(null);
  const [caption, setCaption] = useState(media.caption ?? "");
  const [posting, setPosting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    apiFetch<MetaStatus>("/api/meta/status").then(setMeta).catch(() => undefined);
  }, []);

  const isVideo = media.mediaType === "VIDEO" || media.mediaType === "REEL" || Boolean(media.videoUrl);
  const connected = meta?.connection?.status === "ACTIVE";

  if (done) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3.5" /> Posted to Instagram.
      </p>
    );
  }

  async function post() {
    setPosting(true);
    try {
      await apiFetch(`/api/media/${media.id}/repost`, {
        method: "POST",
        body: JSON.stringify({ caption }),
      });
      setDone(true);
      toast.success("Posted to Instagram.");
    } catch (err) {
      const code = err instanceof FetchError ? err.code : undefined;
      const msg =
        code === "REPOST_DUPLICATE"
          ? "Already posted to that account."
          : code === "NO_META_CONNECTION"
            ? "Connect your Instagram account in Settings first."
            : err instanceof Error
              ? err.message
              : "Repost failed.";
      toast.error(msg);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-xs font-medium">Repost to my Instagram{isVideo ? " (as a reel)" : ""}</p>

      {!connected ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-muted-foreground">
            Connect your Instagram Business/Creator account to post through the official Instagram API.
          </p>
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
            <a href="/settings">
              <Link2 className="size-3.5" /> Connect in Settings
            </a>
          </Button>
        </div>
      ) : (
        <>
          <p className="text-[10px] text-muted-foreground">
            Posting as @{meta?.connection?.igUsername ?? "your account"} via the official Instagram API.
            {isVideo && " Reels take a little longer while Instagram transcodes the video."}
          </p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="repost-caption" className="text-xs">Caption</Label>
            <textarea
              id="repost-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              maxLength={2200}
              className="rounded-md border bg-background p-2 text-sm"
            />
          </div>
          <Button size="sm" className="h-8 w-fit gap-1.5" disabled={posting} onClick={post}>
            {posting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            {posting ? "Posting…" : "Post to Instagram"}
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Only post content you have the rights to — the official API covers how you post, not what
            you post.
          </p>
        </>
      )}
    </div>
  );
}
