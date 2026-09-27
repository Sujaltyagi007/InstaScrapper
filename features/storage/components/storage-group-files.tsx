"use client";
import { friendlyError } from "@/lib/friendly-error";

import useSWR from "swr";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/error-state";
import { format } from "date-fns";
import { ExternalLink, FileAudio, FileVideo, File as FileIcon, Loader2, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { formatBytes } from "@/lib/format-bytes";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface StoredFileRow {
  fileId: string;
  url: string;
  kind: string;
  label: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

const KIND_LABELS: Record<string, string> = {
  MEDIA: "Full-size",
  THUMBNAIL: "Thumbnail",
  STORY: "Story",
  PROFILE_PIC: "Profile picture",
  REEL: "Reel",
  SOUND: "Sound",
  OTHER: "Other",
};

const PREVIEW_LIMIT = 4 * 1024 * 1024;

function Preview({ file }: { file: StoredFileRow }) {
  const type = file.contentType ?? "";
  if (type.startsWith("image/") && (file.sizeBytes ?? 0) <= PREVIEW_LIMIT) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={`/api/storage/preview?fileId=${encodeURIComponent(file.fileId)}`}
        alt=""
        loading="lazy"
        className="size-full object-cover"
      />
    );
  }
  const Icon = type.startsWith("video/") ? FileVideo : type.startsWith("audio/") ? FileAudio : FileIcon;
  return <Icon className="size-6 text-muted-foreground" />;
}

/** One group's files: previews, multi-select, delete. */
export function StorageGroupFiles({ group, onChanged }: { group: string; onChanged: () => void }) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { data, error, mutate } = useSWR<{ files: StoredFileRow[]; total: number; pageSize: number }>(
    `/api/storage/files?group=${encodeURIComponent(group)}&page=${page}`,
    { revalidateOnFocus: false },
  );
  const load = useCallback(() => mutate(), [mutate]);

  function toggle(fileId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }

  async function removeSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} file${selected.size === 1 ? "" : "s"}? This can't be undone.`)) return;
    setBusy(true);
    const ids = new Set(selected);
    // Optimistic: the tiles disappear at once; the re-fetch after brings back any that failed.
    mutate((cur) => cur && { ...cur, files: cur.files.filter((f) => !ids.has(f.fileId)) }, { revalidate: false });
    setSelected(new Set());
    try {
      const res = await apiFetch<{ deleted: number; failed: number }>("/api/storage/files", {
        method: "DELETE",
        body: JSON.stringify({ fileIds: [...ids] }),
      });
      if (res.failed) toast.warning(`${res.deleted} deleted, ${res.failed} couldn't be deleted. Try again.`);
      else toast.success(`${res.deleted} file${res.deleted === 1 ? "" : "s"} deleted.`);
      onChanged();
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't delete those files."));
    } finally {
      await load();
      setBusy(false);
    }
  }

  if (!data) {
    if (error) {
      return (
        <ErrorState title="Couldn't load these files" message={friendlyError(error)} onRetry={load} className="m-3" />
      );
    }
    return (
      <div className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-5 lg:grid-cols-6" aria-busy="true">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="aspect-square w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (data.files.length === 0) return <p className="p-4 text-sm text-muted-foreground">No files.</p>;

  const pages = Math.ceil(data.total / data.pageSize);
  const allOnPage = data.files.every((f) => selected.has(f.fileId));

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={allOnPage}
            onCheckedChange={(checked) =>
              setSelected((prev) => {
                const next = new Set(prev);
                for (const f of data.files) {
                  if (checked) next.add(f.fileId);
                  else next.delete(f.fileId);
                }
                return next;
              })
            }
          />
          Select all on this page
        </label>
        <Button size="sm" variant="destructive" disabled={busy || selected.size === 0} onClick={removeSelected}>
          {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete selected ({selected.size})
        </Button>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {data.files.map((file) => (
          <li key={file.fileId} className="flex flex-col overflow-hidden rounded-lg border">
            <button
              type="button"
              onClick={() => toggle(file.fileId)}
              className="relative flex aspect-square items-center justify-center overflow-hidden bg-muted"
              aria-label={selected.has(file.fileId) ? "Unselect" : "Select"}
            >
              <Preview file={file} />
              <span className="absolute left-2 top-2 rounded bg-background/90 p-0.5">
                <Checkbox checked={selected.has(file.fileId)} tabIndex={-1} />
              </span>
            </button>
            <div className="flex flex-col gap-0.5 p-2 text-xs">
              <span className="truncate font-medium" title={file.label ?? ""}>
                {file.label ?? file.fileId}
              </span>
              <span className="text-muted-foreground">
                {KIND_LABELS[file.kind] ?? file.kind} · {file.sizeBytes ? formatBytes(file.sizeBytes) : "?"} ·{" "}
                {format(new Date(file.createdAt), "d MMM yyyy")}
              </span>
              <a
                href={file.url}
                target="_blank"
                rel="noreferrer"
                className="flex w-fit items-center gap-1 text-muted-foreground hover:underline"
              >
                Open <ExternalLink className="size-3" />
              </a>
            </div>
          </li>
        ))}
      </ul>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {page + 1} of {pages}
          </span>
          <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
