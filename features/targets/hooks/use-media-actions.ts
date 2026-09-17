"use client";

import { useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/fetcher";
import type { Media } from "@prisma/client";

/**
 * The two actions available on an expired media item: re-download the full
 * file on demand, or wipe it permanently. Shared so the dashboard gallery and
 * the mobile simulator can't drift apart.
 */
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
      toast.error(err instanceof Error ? err.message : "Re-download failed.");
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
        // Reported rather than hidden — the record is gone but these files
        // remain in cloud storage.
        toast.warning(
          `Item deleted, but ${res.storageFailures.length} storage file(s) could not be removed.`
        );
      } else {
        toast.success("Item permanently deleted.");
      }
      onChanged?.();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
      return false;
    } finally {
      setBusyId(null);
    }
  };

  return { redownload, permanentDelete, busyId };
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
