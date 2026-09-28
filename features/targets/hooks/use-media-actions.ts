"use client";
import { friendlyError } from "@/lib/friendly-error";
import { toast } from "sonner";
import { useState } from "react";
import { apiFetch, FetchError } from "@/lib/fetcher";
import type { Media } from "@prisma/client";
import type { MediaWithAssets } from "@/types/domain";

export function useMediaActions(onChanged?: () => void) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const redownload = async (mediaId: string): Promise<Media | null> => {
    setBusyId(mediaId);
    try {
      const data = await apiFetch<{ media: Media; isVideo: boolean }>(
        `/api/media/${mediaId}/redownload`,
        { method: "POST" }
      );
      toast.success("Media re-downloaded from Instagram.");
      onChanged?.();
      return data.media;
    } catch (err) {
      toast.error(friendlyError(err, "Re-download failed."));
      return null;
    } finally {
      setBusyId(null);
    }
  };

  // One logged-in request for a post's real video file or all carousel items.
  const loadFull = async (mediaId: string): Promise<MediaWithAssets | null> => {
    setBusyId(mediaId);
    try {
      const data = await apiFetch<{ media: MediaWithAssets }>(`/api/media/${mediaId}/full`, { method: "POST" });
      onChanged?.();
      return data.media;
    } catch (err) {
      const availableAt = err instanceof FetchError && err.code === "NO_SESSION_AVAILABLE" ? err.details?.availableAt : null;
      if (typeof availableAt === "string") {
        const when = new Date(availableAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
        toast.error(`Your Instagram session is resting until ${when}. The post still plays here; save it after that.`);
      } else {
        toast.error(friendlyError(err, "Could not load the full post."));
      }
      return null;
    } finally {
      setBusyId(null);
    }
  };

  const permanentDelete = async (mediaId: string): Promise<boolean> => {
    if (
      !confirm(
        "Permanently delete this item? The file, its thumbnail, and its record will all be removed. This cannot be undone."
      )
    ) {
      return false;
    }

    setBusyId(mediaId);
    try {
      const res = await apiFetch<{ storageFailures: string[] }>(`/api/media/${mediaId}`, {
        method: "DELETE",
      });
      if (res.storageFailures?.length) {
        toast.warning(`Item deleted, but ${res.storageFailures.length} storage file(s) could not be removed.`);
      } else {
        toast.success("Item permanently deleted.");
      }
      onChanged?.();
      return true;
    } catch (err) {
      toast.error(friendlyError(err, "Delete failed."));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  return { redownload, loadFull, permanentDelete, busyId };
}

/** Best available image for a grid tile: thumbnail first, so expired items still render. */
export function displayThumbnail(item: {
  thumbnailUrl: string | null;
  storageUrl: string | null;
  mediaUrl: string | null;
}): string | null {
  return item.thumbnailUrl || item.storageUrl || item.mediaUrl || null;
}

/** Best available asset for full-size viewing / download. Null once expired. */
export function displayFullAsset(item: {
  storageUrl: string | null;
  videoUrl: string | null;
  mediaUrl: string | null;
  isExpired: boolean;
}): string | null {
  if (item.isExpired) return null;
  return item.storageUrl || item.videoUrl || item.mediaUrl || null;
}
