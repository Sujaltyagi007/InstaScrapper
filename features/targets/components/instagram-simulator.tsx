"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  ChevronLeft,
  MoreHorizontal,
  Grid3X3,
  PlaySquare,
  Bookmark,
  UserSquare,
  Download,
  Play,
  Image as ImageIcon,
  Heart,
  MessageCircle,
  Send,
  Layers,
  RefreshCw,
  Loader2,
  Info,
  CloudOff,
  Trash2,
} from "lucide-react";
import type { Media, TargetSnapshot } from "@prisma/client";
import { downloadMedia, isThumbnailOnlyVideo } from "../lib/download-media";
import { useMediaActions, displayThumbnail, displayFullAsset } from "../hooks/use-media-actions";
import { apiFetch } from "@/lib/fetcher";

interface InstagramSimulatorProps {
  snapshot?: TargetSnapshot | null;
  media: Media[];
  username: string;
  targetId: string;
  onDataChanged?: () => void;
}

const SCROLL_AREA = "flex-1 min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden";

export function InstagramSimulator({
  snapshot,
  media,
  username,
  targetId,
  onDataChanged,
}: InstagramSimulatorProps) {
  const [view, setView] = useState<"profile" | "post">("profile");
  const [selectedPost, setSelectedPost] = useState<Media | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [view, selectedPost?.id]);

  const profilePic = snapshot?.profilePictureStorageUrl || snapshot?.profilePictureUrl || "";
  const postsCount = snapshot?.mediaCount ?? media.length;
  const followersCount = snapshot?.followersCount ?? 0;
  const followingCount = snapshot?.followsCount ?? 0;
  const hasData = Boolean(snapshot) || media.length > 0;

  const runCheck = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      await apiFetch(`/api/targets/${targetId}/check`, { method: "POST" });
      onDataChanged?.();
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Check failed.");
    } finally {
      setChecking(false);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (num >= 10_000) return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
    return num.toLocaleString();
  };

  return (
    <div className="flex flex-col items-center sm:gap-3">
      <div className="w-full sm:max-w-sm bg-background sm:border sm:rounded-2xl overflow-hidden relative sm:shadow-xl flex flex-col text-foreground h-[100dvh] sm:h-162.5 sm:max-h-[calc(100vh-5rem)]">
        <div ref={scrollRef} className={SCROLL_AREA}>
          {!hasData && (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-muted">
                <ImageIcon className="size-7 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold">Nothing scraped yet</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  @{username} has no stored snapshot or media. Profile details and posts
                  appear here after the first monitoring check.
                </p>
              </div>
              <button type="button" onClick={runCheck} disabled={checking} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60">
                {checking ? (
                  <Fragment>
                    <Loader2 className="size-3.5 animate-spin" /> Checking…
                  </Fragment>
                ) : (
                  <Fragment>
                    <RefreshCw className="size-3.5" /> Run first check
                  </Fragment>
                )}
              </button>
              {checking && (
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  This can take up to a minute — Instagram often serves its login page
                  to logged-out requests and we retry past it.
                </p>
              )}
              {checkError && <p className="text-[10px] text-destructive">{checkError}</p>}
            </div>
          )}

          {hasData && view === "profile" && (
            <div className="flex flex-col pb-10">
              <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border/40 bg-background/95 px-4 py-3 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <ChevronLeft className="size-6" aria-hidden />
                  <h1 className="text-xl font-bold tracking-tight">{username}</h1>
                </div>
                <MoreHorizontal className="size-6" aria-hidden />
              </div>

              {/* Profile info */}
              <div className="flex items-center justify-between px-4 pt-4">
                <div className="size-20 shrink-0 rounded-full bg-linear-to-tr from-yellow-400 via-red-500 to-fuchsia-600 p-0.5">
                  <div className="flex size-full items-center justify-center overflow-hidden rounded-full border-2 border-background bg-muted">
                    {profilePic ? (
                      <img src={profilePic} alt={username} className="size-full object-cover" />
                    ) : (
                      <UserSquare className="size-10 text-muted-foreground" />
                    )}
                  </div>
                </div>
                <div className="ml-6 flex flex-1 justify-around">
                  <Stat label="Posts" value={formatNumber(postsCount)} />
                  <Stat label="Followers" value={formatNumber(followersCount)} />
                  <Stat label="Following" value={formatNumber(followingCount)} />
                </div>
              </div>

              {/* Bio */}
              <div className="flex flex-col gap-0.5 px-4 pt-3 pb-4">
                <span className="text-sm font-semibold">{snapshot?.name || username}</span>
                {snapshot?.biography && (
                  <span className="text-sm leading-tight whitespace-pre-wrap">
                    {snapshot.biography}
                  </span>
                )}
                {snapshot?.website && (
                  <a href={snapshot.website} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-medium text-sky-600 dark:text-sky-400">
                    {snapshot.website.replace(/^https?:\/\//, "")}
                  </a>
                )}
              </div>

              {/* Decorative only — appearance without behaviour. */}
              <div className="mb-6 flex gap-2 px-4" aria-hidden>
                <div className="flex flex-1 cursor-default items-center justify-center gap-1 rounded-lg bg-muted py-1.5 text-sm font-semibold select-none">
                  Following <ChevronLeft className="size-4 -rotate-90" />
                </div>
                <div className="flex-1 cursor-default rounded-lg bg-muted py-1.5 text-center text-sm font-semibold select-none">
                  Message
                </div>
              </div>

              {/* Grid tabs */}
              <div className="sticky top-13.25 z-20 flex items-center justify-around border-t border-border bg-background pt-3 pb-3" aria-hidden>
                <div className="flex flex-1 justify-center border-b border-foreground pb-2">
                  <Grid3X3 className="size-6" />
                </div>
                <div className="flex flex-1 justify-center pb-2 text-muted-foreground">
                  <PlaySquare className="size-6" />
                </div>
                <div className="flex flex-1 justify-center pb-2 text-muted-foreground">
                  <Bookmark className="size-6" />
                </div>
                <div className="flex flex-1 justify-center pb-2 text-muted-foreground">
                  <UserSquare className="size-6" />
                </div>
              </div>

              {/* Media grid */}
              {media.length === 0 ? (
                <p className="px-8 py-10 text-center text-xs text-muted-foreground">
                  The profile was captured, but no media is stored yet.
                </p>
              ) : (
                <Fragment>
                  <div className="grid grid-cols-3 gap-px">
                    {media.map((item) => {
                      const displayUrl = displayThumbnail(item);
                      const isVideoKind = item.mediaType === "VIDEO" || item.mediaType === "REEL";
                      const isCarousel = item.mediaType === "CAROUSEL_ALBUM";
                      return (
                        <button key={item.id} type="button" className="group relative aspect-square bg-muted" onClick={() => { setSelectedPost(item); setView("post"); }}>
                          {displayUrl ? (
                            <img src={displayUrl} alt={item.caption?.slice(0, 80) || `Post by ${username}`} className="h-full w-full object-cover transition-opacity group-active:opacity-80" loading="lazy" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                              <ImageIcon className="size-6" />
                            </div>
                          )}
                          {isVideoKind && (
                            <span className="absolute top-2 right-2 text-white drop-shadow">
                              <Play className="size-4 fill-white" />
                            </span>
                          )}
                          {isCarousel && (
                            <span className="absolute top-2 right-2 text-white drop-shadow">
                              <Layers className="size-4" />
                            </span>
                          )}
                          {item.isExpired && (
                            <span className="absolute bottom-1 left-1 rounded bg-amber-500/90 px-1 py-px text-[9px] font-semibold text-white">
                              Expired
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex items-start gap-2 px-4 text-[10px] leading-relaxed text-muted-foreground">
                    <Info className="mt-px size-3 shrink-0" />
                    <span>
                      Showing {media.length} stored {media.length === 1 ? "post" : "posts"}.
                      Without a logged-in session Instagram only serves its 12 newest posts
                      per check, so older posts can&apos;t be backfilled — the grid grows as
                      new posts are detected.
                    </span>
                  </div>
                </Fragment>
              )}
            </div>
          )}

          {hasData && view === "post" && selectedPost && (
            <PostView post={selectedPost} username={username} profilePic={profilePic} onBack={() => {
              setView("profile");
              setSelectedPost(null);
            }}
              onDataChanged={onDataChanged}
              onPostUpdated={setSelectedPost}
              onPostDeleted={() => {
                setView("profile");
                setSelectedPost(null);
              }}
            />
          )}
        </div>
      </div>

      {hasData && (
        <button type="button" onClick={runCheck} disabled={checking} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60">
          {checking ? (
            <Fragment>
              <Loader2 className="size-3 animate-spin" /> Refreshing from Instagram…
            </Fragment>
          ) : (
            <Fragment>
              <RefreshCw className="size-3" /> Run check now
            </Fragment>
          )}
        </button>
      )}
      {hasData && checkError && <p className="text-xs text-destructive">{checkError}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-lg leading-tight font-semibold">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function PostView({
  post,
  username,
  profilePic,
  onBack,
  onDataChanged,
  onPostUpdated,
  onPostDeleted,
}: {
  post: Media;
  username: string;
  profilePic: string;
  onBack: () => void;
  onDataChanged?: () => void;
  onPostUpdated?: (media: Media) => void;
  onPostDeleted?: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const { redownload, permanentDelete, busyId } = useMediaActions(onDataChanged);
  const thumbnailOnly = isThumbnailOnlyVideo(post);
  const assetUrl = displayFullAsset(post) ?? "";
  const busy = busyId === post.id;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadMedia(assetUrl, post.mediaType, post.externalMediaId, username);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col bg-background pb-10">
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border/40 bg-background/95 px-4 py-3 backdrop-blur-sm">
        <button type="button" onClick={onBack} aria-label="Back to profile">
          <ChevronLeft className="size-6" />
        </button>
        <h1 className="text-base font-bold tracking-tight">Posts</h1>
      </div>

      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-full bg-linear-to-tr from-yellow-400 via-red-500 to-fuchsia-600 p-px">
            <div className="size-full overflow-hidden rounded-full border border-background bg-muted">
              {profilePic ? (
                <img src={profilePic} alt="" className="size-full object-cover" />
              ) : (
                <UserSquare className="m-1 size-4" />
              )}
            </div>
          </div>
          <span className="text-sm font-semibold">{username}</span>
        </div>
        <MoreHorizontal className="size-5" aria-hidden />
      </div>

      <div className="relative flex w-full items-center justify-center bg-black">
        {post.isExpired ? (
          <div className="relative w-full">
            {displayThumbnail(post) && (
              <img src={displayThumbnail(post) || ""} alt="" className="max-h-105 w-full object-contain opacity-40 blur-sm" />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-6 text-center">
              <CloudOff className="size-6 text-white/80" />
              <p className="text-xs font-semibold text-white">Full file expired</p>
              <p className="text-[10px] leading-relaxed text-white/70">
                Removed after 48h to save storage. Re-download or delete below.
              </p>
            </div>
          </div>
        ) : post.videoUrl ? (
          <video src={post.storageUrl || post.videoUrl} controls playsInline className="max-h-105 w-full object-contain" />
        ) : assetUrl ? (
          <img src={assetUrl} alt={post.caption ?? ""} className="max-h-105 w-full object-contain" />
        ) : (
          <div className="flex h-60 w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="size-8" />
          </div>
        )}
        {thumbnailOnly && (
          <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[10px] font-medium text-white">
            Thumbnail only — video needs a logged-in session
          </span>
        )}
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-4" aria-hidden>
          <Heart className="size-6" />
          <MessageCircle className="size-6" />
          <Send className="size-6" />
        </div>
        <div className="flex items-center gap-3">
          {post.isExpired ? (
            <Fragment>
              <button type="button" disabled={busy} onClick={async () => { const updated = await redownload(post.id); if (updated) onPostUpdated?.(updated); }} className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-60">
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Re-download
              </button>
              <button type="button" disabled={busy} onClick={async () => { const done = await permanentDelete(post.id); if (done) onPostDeleted?.(); }} className="flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1.5 text-[11px] font-semibold text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-60">
                <Trash2 className="size-3.5" />
                Delete
              </button>
            </Fragment>
          ) : (
            <Fragment>
              {assetUrl && (
                <button type="button" onClick={handleDownload} disabled={downloading} className="flex items-center justify-center rounded-full bg-primary/10 p-1.5 text-primary transition-colors hover:bg-primary/20 disabled:opacity-60" title={thumbnailOnly ? "Download thumbnail image" : "Download media"}>
                  {downloading ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <Download className="size-5" />
                  )}
                </button>
              )}
              <Bookmark className="size-6" aria-hidden />
            </Fragment>
          )}
        </div>
      </div>

      <div className="space-y-2 px-4 pb-4">
        <div className="text-sm">
          <span className="mr-2 font-semibold">{username}</span>
          <span className="whitespace-pre-wrap">
            {post.caption || <span className="text-muted-foreground italic">No caption</span>}
          </span>
        </div>
        <div className="text-[10px] tracking-wide text-muted-foreground uppercase">
          {post.timestamp ? `Posted ${formatDistanceToNow(new Date(post.timestamp), { addSuffix: true })}`
            : `First seen ${format(new Date(post.firstSeenAt), "d MMM yyyy")}`}
          {" · "}
          {post.mediaType}
        </div>
      </div>
    </div>
  );
}
