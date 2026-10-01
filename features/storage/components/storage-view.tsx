"use client";
import { friendlyError } from "@/lib/friendly-error";

import useSWR from "swr";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, Sparkles, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";
import { STORAGE_KEY } from "@/lib/swr-keys";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/error-state";
import { LoadingState } from "@/components/common/loading-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StorageGroupFiles } from "@/features/storage/components/storage-group-files";

interface Group {
  key: string;
  label: string;
  deletedTarget: boolean;
  files: number;
  bytes: number;
  byKind: Record<string, { files: number; bytes: number }>;
}

interface Overview {
  totalFiles: number;
  totalBytes: number;
  quotaBytes: number;
  mediaKeepHours: number | null;
  newlyRegistered: number;
  groups: Group[];
}

const KIND_NAMES: Record<string, string> = {
  MEDIA: "full-size",
  THUMBNAIL: "thumbnails",
  STORY: "stories",
  PROFILE_PIC: "profile pictures",
  REEL: "reel files",
  SOUND: "sounds",
  OTHER: "other",
};

const KEEP_OPTIONS = [
  { value: "48", label: "48 hours" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
  { value: "forever", label: "Until I delete them" },
];

export function StorageView() {
  // No refetch on tab focus: this call also reconciles the file register with the bucket.
  const { data: overview, error, mutate } = useSWR<Overview>(STORAGE_KEY, { revalidateOnFocus: false });
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => mutate(), [mutate]);

  async function run(label: string, action: () => Promise<string>) {
    setBusy(label);
    try {
      toast.success(await action());
      await refresh();
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(friendlyError(err, "Something went wrong."));
    } finally {
      setBusy(null);
    }
  }

  function deleteGroup(group: Group, kinds?: string[]) {
    const what = kinds ? `the full-size files of ${group.label}` : `all ${group.files} files of ${group.label}`;
    if (!confirm(`Delete ${what}? This can't be undone.`)) return;
    run(`group:${group.key}:${kinds ? "heavy" : "all"}`, async () => {
      const res = await apiFetch<{ deleted: number; failed: number }>("/api/storage/groups", {
        method: "DELETE",
        body: JSON.stringify({ group: group.key, kinds }),
      });
      return res.failed ? `${res.deleted} deleted, ${res.failed} failed. Try again.` : `${res.deleted} files deleted.`;
    });
  }

  if (!overview) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
          <p className="text-sm text-muted-foreground">
            Every file this app keeps for you: scraped photos and videos, profile pictures, reels and sounds.
          </p>
        </div>
        {error ? (
          <ErrorState title="Couldn't load your storage" message={friendlyError(error)} onRetry={refresh} />
        ) : (
          <StorageSkeleton />
        )}
      </div>
    );
  }

  const percent = Math.min(100, (overview.totalBytes / overview.quotaBytes) * 100);
  const profilePics = overview.groups.reduce((n, g) => n + (g.byKind.PROFILE_PIC?.files ?? 0), 0);
  const accountGroups = overview.groups.filter((g) => g.key.startsWith("t:") || g.key.startsWith("u:")).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
        <p className="text-sm text-muted-foreground">
          Every file this app keeps for you: scraped photos and videos, profile pictures, reels and sounds.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
          <CardDescription>
            {overview.totalFiles} files · {formatBytes(overview.totalBytes)} of {formatBytes(overview.quotaBytes)}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", percent > 90 ? "bg-destructive" : percent > 75 ? "bg-amber-500" : "bg-primary")}
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Keep full-size photos and videos for</span>
              <span className="text-xs text-muted-foreground">
                After that only the small thumbnail stays; you can re-download a post from its account page.
              </span>
            </div>
            <Select
              value={overview.mediaKeepHours === null ? "forever" : String(overview.mediaKeepHours)}
              onValueChange={(value) =>
                run("keep", async () => {
                  await apiFetch("/api/storage/settings", {
                    method: "PUT",
                    body: JSON.stringify({ mediaKeepHours: value === "forever" ? null : Number(value) }),
                  });
                  return "Saved.";
                })
              }
            >
              <SelectTrigger className="w-full sm:w-48" disabled={busy !== null}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KEEP_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {profilePics > accountGroups && (
            <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm">
                {profilePics} profile-picture copies stored. Older versions of the app saved a new copy on every check.
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => {
                  if (!confirm("Delete old profile-picture copies? Each account keeps its current picture.")) return;
                  run("pics", async () => {
                    const res = await apiFetch<{ deleted: number; failed: number }>("/api/storage/cleanup", { method: "POST" });
                    return `${res.deleted} old copies deleted.`;
                  });
                }}
              >
                {busy === "pics" ? <Loader2 className="animate-spin" /> : <Sparkles />} Clean up copies
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
          <CardDescription>
            Grouped by account. Files of deleted accounts you chose to keep are marked &quot;deleted account&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {overview.groups.length === 0 && <p className="text-sm text-muted-foreground">Nothing stored yet.</p>}
          {overview.groups.map((group) => {
            const isOpen = open === group.key;
            const isAccount = group.key.startsWith("t:") || group.key.startsWith("u:");
            const heavy = (group.byKind.MEDIA?.files ?? 0) + (group.byKind.STORY?.files ?? 0);
            return (
              <div key={group.key} className="rounded-lg border">
                <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    className="flex min-w-0 items-start gap-2 text-left"
                    onClick={() => setOpen(isOpen ? null : group.key)}
                  >
                    {isOpen ? <ChevronDown className="mt-0.5 size-4 shrink-0" /> : <ChevronRight className="mt-0.5 size-4 shrink-0" />}
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {group.label}
                        {group.deletedTarget && <Badge variant="warning">deleted account</Badge>}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {group.files} files · {formatBytes(group.bytes)} ·{" "}
                        {Object.entries(group.byKind)
                          .map(([kind, v]) => `${v.files} ${KIND_NAMES[kind] ?? kind}`)
                          .join(", ")}
                      </span>
                    </span>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    {isAccount && heavy > 0 && (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => deleteGroup(group, ["MEDIA", "STORY"])}>
                        Delete full-size only
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => deleteGroup(group)}>
                      {busy === `group:${group.key}:all` ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete all
                    </Button>
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t">
                    <StorageGroupFiles key={`${group.key}:${reloadKey}`} group={group.key} onChanged={refresh} />
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

/** Usage card (bar + keep-for setting) and the per-account groups, while the overview loads. */
function StorageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading storage">
      <div className="rounded-xl border bg-card p-4">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="mt-2 h-3 w-52" />
        <Skeleton className="mt-4 h-2 w-full rounded-full" />
        <div className="mt-4 flex items-center justify-between gap-3">
          <Skeleton className="h-3.5 w-56 max-w-full" />
          <Skeleton className="h-8 w-36 rounded-md" />
        </div>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <Skeleton className="h-4 w-28" />
        <LoadingState rows={4} className="mt-2" />
      </div>
    </div>
  );
}
