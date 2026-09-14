"use client";

import { useState } from "react";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { Play, Image as ImageIcon, ExternalLink, Film, Sparkles } from "lucide-react";
import type { Media } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface MediaGalleryProps {
  media: Media[];
  username: string;
}

export function MediaGallery({ media, username }: MediaGalleryProps) {
  const [selectedItem, setSelectedItem] = useState<Media | null>(null);

  if (!media || media.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center bg-card/40">
        <ImageIcon className="size-8 text-muted-foreground/60 mb-2" />
        <p className="text-sm font-medium">No media downloaded yet</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          Scraped posts, reels, and stories for @{username} will be displayed here along with their full captions and HD assets.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {media.map((item) => {
          const displayUrl = item.storageUrl || item.mediaUrl;
          const isVideo = item.mediaType === "VIDEO" || item.mediaType === "REEL" || Boolean(item.videoUrl);

          return (
            <div
              key={item.id}
              onClick={() => setSelectedItem(item)}
              className="group relative aspect-square overflow-hidden rounded-lg border bg-muted cursor-pointer transition hover:border-primary/50 hover:shadow-md"
            >
              {displayUrl ? (
                <img
                  src={displayUrl}
                  alt={item.caption || `Instagram media ${item.externalMediaId}`}
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted/60 text-muted-foreground">
                  <ImageIcon className="size-6" />
                </div>
              )}

              {/* Badge Overlay */}
              <div className="absolute top-2 left-2 flex items-center gap-1">
                {item.storageUrl && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-black/60 text-white backdrop-blur border-none flex items-center gap-1">
                    <Sparkles className="size-2.5 text-amber-400" /> ImageKit HD
                  </Badge>
                )}
                {isVideo && (
                  <span className="flex size-5 items-center justify-center rounded-full bg-black/70 text-white shadow">
                    <Play className="size-2.5 fill-current ml-0.5" />
                  </span>
                )}
              </div>

              {/* Caption Preview Gradient */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2.5 pt-6 text-white opacity-0 transition group-hover:opacity-100">
                <p className="line-clamp-2 text-xs font-normal leading-snug">
                  {item.caption || "No caption"}
                </p>
                {item.timestamp && (
                  <p className="mt-1 text-[10px] text-zinc-300">
                    {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Lightbox / Detail Dialog */}
      <Dialog open={Boolean(selectedItem)} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-2xl overflow-hidden p-0 gap-0">
          {selectedItem && (
            <div>
              <div className="relative bg-black flex items-center justify-center max-h-[480px] overflow-hidden">
                {selectedItem.videoUrl ? (
                  <video
                    src={selectedItem.storageUrl || selectedItem.videoUrl}
                    controls
                    autoPlay
                    className="max-h-[480px] w-full object-contain"
                  />
                ) : selectedItem.storageUrl || selectedItem.mediaUrl ? (
                  <img
                    src={selectedItem.storageUrl || selectedItem.mediaUrl || ""}
                    alt={selectedItem.caption || "Instagram media"}
                    className="max-h-[480px] w-full object-contain"
                  />
                ) : null}
              </div>

              <div className="p-5 space-y-3 bg-card">
                <DialogHeader>
                  <div className="flex items-center justify-between">
                    <DialogTitle className="text-base flex items-center gap-2">
                      <span>@{username}</span>
                      <Badge variant="outline" className="text-xs">
                        {selectedItem.mediaType}
                      </Badge>
                      {selectedItem.storageUrl && (
                        <Badge variant="secondary" className="text-xs text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40">
                          Persisted to ImageKit
                        </Badge>
                      )}
                    </DialogTitle>
                    {selectedItem.permalink && (
                      <Button asChild variant="outline" size="sm" className="h-7 text-xs gap-1">
                        <a href={selectedItem.permalink} target="_blank" rel="noopener noreferrer">
                          <span>Instagram</span>
                          <ExternalLink className="size-3" />
                        </a>
                      </Button>
                    )}
                  </div>
                  {selectedItem.timestamp && (
                    <DialogDescription className="text-xs">
                      Posted {formatDistanceToNow(new Date(selectedItem.timestamp), { addSuffix: true })}
                    </DialogDescription>
                  )}
                </DialogHeader>

                <div className="rounded-lg bg-muted/50 p-3 text-sm max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {selectedItem.caption || <span className="text-muted-foreground italic">No caption was provided for this post.</span>}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
