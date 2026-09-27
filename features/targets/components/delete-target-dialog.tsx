"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DeleteTargetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One target, or several for a bulk delete. */
  targets: { id: string; username: string }[];
  /** Fires immediately, before the request — hide the rows and close the dialog without waiting. */
  onOptimisticDelete?: (ids: string[]) => void;
  /** Fires once the request actually succeeds (bulk: even if some of it failed). */
  onDeleted: () => void;
  /** Fires if the request fails outright — undo the optimistic removal (e.g. re-fetch the list). */
  onDeleteFailed?: () => void;
}

/**
 * Asks what happens to an account's stored files when it's deleted: delete
 * them too, or keep them (they stay on the Storage page under the account's name).
 */
export function DeleteTargetDialog({
  open,
  onOpenChange,
  targets,
  onOptimisticDelete,
  onDeleted,
  onDeleteFailed,
}: DeleteTargetDialogProps) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ files: number; bytes: number } | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  const single = targets.length === 1 ? targets[0] : null;

  // Reset the choice each time the dialog opens (during render, not in an effect).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDeleteFiles(false);
      setUsage(null);
    }
  }

  useEffect(() => {
    if (!open || !single) return;
    apiFetch<{ files: number; bytes: number }>(`/api/targets/${single.id}/files`)
      .then(setUsage)
      .catch(() => setUsage(null));
  }, [open, single]);

  async function confirm() {
    setBusy(true);
    // Hide the rows and close right away — don't make the user watch a spinner
    // for a delete they already confirmed. A failure below undoes this.
    onOptimisticDelete?.(targets.map((t) => t.id));
    onOpenChange(false);
    try {
      if (single) {
        await apiFetch(`/api/targets/${single.id}?deleteFiles=${deleteFiles ? "1" : "0"}`, { method: "DELETE" });
        toast.success(`@${single.username} deleted${deleteFiles ? " with its files" : ". Its files are on the Storage page"}.`);
      } else {
        const res = await apiFetch<{ count: number; total: number }>("/api/targets/bulk", {
          method: "POST",
          body: JSON.stringify({ ids: targets.map((t) => t.id), action: "delete", deleteFiles }),
        });
        // A partial bulk failure leaves some targets not actually deleted; onDeleted's
        // refresh() below re-fetches the true list, so any survivor reappears.
        if (res.count < res.total) toast.warning(`${res.count} of ${res.total} deleted; the rest failed.`);
        else toast.success(`${res.count} account${res.count === 1 ? "" : "s"} deleted.`);
      }
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete.");
      onDeleteFailed?.();
    } finally {
      setBusy(false);
    }
  }

  const title = single ? `Delete @${single.username}?` : `Delete ${targets.length} accounts?`;
  const usageText = usage
    ? usage.files === 0
      ? "No stored files."
      : `${usage.files} stored file${usage.files === 1 ? "" : "s"}, ${formatBytes(usage.bytes)}.`
    : single
      ? "Counting stored files…"
      : null;

  const option = (value: boolean, heading: string, detail: string) => (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border p-3 text-sm",
        deleteFiles === value ? "border-primary bg-primary/5" : "hover:bg-muted",
      )}
    >
      <input
        type="radio"
        name="delete-files"
        className="mt-1"
        checked={deleteFiles === value}
        onChange={() => setDeleteFiles(value)}
        disabled={busy}
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{heading}</span>
        <span className="text-muted-foreground">{detail}</span>
      </span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Its history (checks, events, snapshots) is removed and can&apos;t be restored. {usageText}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {option(
            false,
            "Keep the stored files",
            "Photos, videos and profile pictures stay in storage. You can view or delete them later on the Storage page.",
          )}
          {option(true, "Delete the stored files too", "Frees the storage space now. This can't be undone.")}
        </div>
        <p className="text-xs text-muted-foreground">
          See everything you store on the{" "}
          <Link href="/storage" className="underline">
            Storage page
          </Link>
          .
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
