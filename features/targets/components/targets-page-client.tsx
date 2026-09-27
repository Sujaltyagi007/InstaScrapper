"use client";
import { friendlyError } from "@/lib/friendly-error";
import Link from "next/link";
import { mutate } from "swr";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Fragment } from "react";
import { apiFetch } from "@/lib/fetcher";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import type { TargetWithMonitor } from "@/types/domain";
import { EmptyState } from "@/components/common/empty-state";
import { useTargetQuota } from "@/features/account/hooks/use-target-quota";
import { TargetAvatar } from "@/features/targets/components/target-avatar";
import { TARGETS_KEY, useTargets } from "@/features/targets/hooks/use-targets";
import { prefetchTargetDetail } from "@/features/targets/hooks/use-target-detail";
import { TargetQuotaBanner } from "@/features/account/components/target-quota-banner";
import { DeleteTargetDialog } from "@/features/targets/components/delete-target-dialog";
import { TargetsListSkeleton } from "@/features/targets/components/targets-list-skeleton";
import { TargetStatusDot, targetStatusInfo } from "@/features/targets/components/target-status-badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, } from "@/components/ui/dropdown-menu";
import { ExternalLink, MoreHorizontal, Pause, Play, Plus, Radar, Search, SearchX, Trash2, X } from "lucide-react";
import { ErrorState, InlineRefreshError } from "@/components/common/error-state";

const ATTENTION_STATUSES = new Set([
  "RATE_LIMITED",
  "BACKOFF",
  "AUTH_ERROR",
  "REAUTH_REQUIRED",
  "NOT_FOUND",
  "UNAVAILABLE",
  "UNSUPPORTED",
  "INVALID",
]);

type StatusFilter = "all" | "ACTIVE" | "PAUSED" | "attention" | "DISCOVERED";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
  { value: "attention", label: "Needs attention" },
  { value: "DISCOVERED", label: "Discovered" },
];

function matchesStatus(target: TargetWithMonitor, filter: StatusFilter) {
  if (filter === "all") return true;
  if (filter === "attention") return ATTENTION_STATUSES.has(target.status);
  return target.status === filter;
}

/** "just now", "5m", "3h", "2d", then a date. */
function shortAgo(value: string | Date | null) {
  if (!value) return "Never";
  const date = new Date(value);
  const sec = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (sec < 60) return "Just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatInterval(seconds?: number | null) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function compactCount(n?: number | null) {
  if (n == null) return null;
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

type TargetsPayload = { targets: TargetWithMonitor[] } | undefined;


function setActiveOptimistically(ids: Set<string>, active: boolean) {
  return mutate(
    TARGETS_KEY,
    (data: TargetsPayload) =>
      data && {
        targets: data.targets.map((t) => {
          if (!ids.has(t.id)) return t;
          const status: TargetWithMonitor["status"] = !active ? "PAUSED" : t.status === "PAUSED" ? "ACTIVE" : t.status;
          return { ...t, status, monitor: t.monitor ? { ...t.monitor, active } : t.monitor };
        }),
      },
    { revalidate: false },
  );
}

/** Drops deleted rows from the cached list right away, before the delete request resolves. */
function removeOptimistically(ids: Set<string>) {
  return mutate(
    TARGETS_KEY,
    (data: TargetsPayload) => data && { targets: data.targets.filter((t) => !ids.has(t.id)) },
    { revalidate: false },
  );
}

/** All the interactivity for /targets. Rendered by the server page below, inside an SWRConfig that already has the first paint's data. */
export function TargetsPageClient() {
  const router = useRouter();
  const { targets, loading, error, refresh } = useTargets();
  const { quota, loading: quotaLoading, refresh: refreshQuota } = useTargetQuota();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<{ id: string; username: string }[] | null>(null);

  const searched = useMemo(() => {
    if (!targets) return [];
    const q = query.trim().toLowerCase().replace(/^@/, "");
    if (!q) return targets;
    return targets.filter(
      (t) => t.username.toLowerCase().includes(q) || t.snapshots?.[0]?.name?.toLowerCase().includes(q),
    );
  }, [targets, query]);

  const counts = useMemo(() => {
    const c = {} as Record<StatusFilter, number>;
    for (const f of STATUS_FILTERS) c[f.value] = searched.filter((t) => matchesStatus(t, f.value)).length;
    return c;
  }, [searched]);

  const filteredTargets = useMemo(
    () => searched.filter((t) => matchesStatus(t, statusFilter)),
    [searched, statusFilter],
  );

  const allVisibleSelected = filteredTargets.length > 0 && filteredTargets.every((t) => selected.has(t.id));
  const someVisibleSelected = filteredTargets.some((t) => selected.has(t.id));
  const headerChecked = allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false;

  function toggleOne(targetId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(targetId)) next.delete(targetId);
      else next.add(targetId);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      filteredTargets.forEach((t) => (allVisibleSelected ? next.delete(t.id) : next.add(t.id)));
      return next;
    });
  }

  async function togglePause(targetId: string, active: boolean) {
    setBusyId(targetId);
    setActiveOptimistically(new Set([targetId]), active);
    try {
      await apiFetch(`/api/targets/${targetId}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      toast.success(active ? "Monitoring resumed." : "Monitoring paused.");
      refresh();
      refreshQuota();
    } catch (err) {
      toast.error(friendlyError(err, "Something went wrong."));
      refresh(); // undo the optimistic flip with the real server state
    } finally {
      setBusyId(null);
    }
  }

  function remove(targetId: string) {
    const target = targets?.find((t) => t.id === targetId);
    if (target) setDeleting([{ id: target.id, username: target.username }]);
  }

  async function bulkAction(action: "pause" | "resume" | "delete") {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (action === "delete") {
      setDeleting((targets ?? []).filter((t) => selected.has(t.id)).map((t) => ({ id: t.id, username: t.username })));
      return;
    }
    setBulkBusy(true);
    setActiveOptimistically(new Set(ids), action === "resume");
    try {
      const data = await apiFetch<{ count: number; total: number }>("/api/targets/bulk", {
        method: "POST",
        body: JSON.stringify({ ids, action }),
      });
      const verb = action === "pause" ? "paused" : "resumed";
      if (data.count < data.total) {
        toast.warning(`${data.count} of ${data.total} target${data.total === 1 ? "" : "s"} ${verb}; the rest failed.`);
      } else {
        toast.success(`${data.count} target${data.count === 1 ? "" : "s"} ${verb}.`);
      }
      setSelected(new Set());
      refresh();
      refreshQuota();
    } catch (err) {
      toast.error(friendlyError(err, "Something went wrong."));
      refresh(); // undo the optimistic flip with the real server state
    } finally {
      setBulkBusy(false);
    }
  }

  function rowMenu(target: TargetWithMonitor) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon"
            disabled={busyId === target.id}
            className="size-8 text-muted-foreground"
            aria-label={`Actions for @${target.username}`}
            onClick={(e) => e.stopPropagation()} >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => router.push(`/targets/${target.id}`)}>
            <ExternalLink /> Open
          </DropdownMenuItem>
          {target.monitor?.active ? (
            <DropdownMenuItem onSelect={() => togglePause(target.id, false)}>
              <Pause /> Pause
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => togglePause(target.id, true)}>
              <Play /> Resume
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => remove(target.id)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const hasTargets = !!targets && targets.length > 0;
  const firstLoad = loading && !targets && !error;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Targets</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Accounts you&apos;re monitoring
            {quota ? (
              <Fragment>
                {" · "}
                <span className="tabular-nums">
                  {quota.used}/{quota.limit}
                </span>{" "}
                used
              </Fragment>
            ) : quotaLoading ? (
              <span className="ml-1.5 inline-block h-3 w-14 animate-pulse rounded-md bg-muted align-middle" />
            ) : null}
          </p>
        </div>
        {quota?.level === "FULL" ? (
          <Button size="sm" disabled title="Account limit reached">
            <Plus />
            <span>
              Add<span className="hidden sm:inline"> target</span>
            </span>
          </Button>
        ) : (
          <Button size="sm" asChild>
            <Link href="/targets/new">
              <Plus />
              <span>
                Add<span className="hidden sm:inline"> target</span>
              </span>
            </Link>
          </Button>
        )}
      </div>

      <TargetQuotaBanner quota={quota} />

      {/* Toolbar: search + status chips */}
      {firstLoad && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center" aria-hidden>
          <Skeleton className="h-8 w-full sm:w-64" />
          <div className="flex gap-1.5">
            {["w-12", "w-16", "w-16", "w-28"].map((w, i) => (
              <Skeleton key={i} className={`h-7 rounded-full ${w}`} />
            ))}
          </div>
        </div>
      )}
      {hasTargets && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search accounts…"
              className="h-8 pl-8 pr-8 text-sm"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 scrollbar-none sm:mx-0 sm:px-0">
            {STATUS_FILTERS.filter((f) => f.value !== "DISCOVERED" || counts.DISCOVERED > 0).map((f) => {
              const active = statusFilter === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setStatusFilter(f.value)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
                    active ? "border-foreground bg-foreground text-background"
                      : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                    f.value === "attention" && counts.attention > 0 && !active && "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {f.label}
                  <span className={cn("tabular-nums", active ? "opacity-70" : "opacity-60")}>{counts[f.value]}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* List */}
      {/* A refresh failed but we still have the last list: keep showing it. */}
      {error && targets && <InlineRefreshError message={error} onRetry={refresh} />}

      {firstLoad ? (
        <TargetsListSkeleton />
      ) : error && !targets ? (
        <ErrorState title="Couldn't load your targets" message={error} onRetry={refresh} />
      ) : !hasTargets ? (
        <div className="rounded-xl border">
          <EmptyState icon={Radar} title="No targets yet"
            description="Add a public Instagram account to start monitoring it for changes."
            actionLabel="Add target" onAction={() => router.push("/targets/new")}
          />
        </div>
      ) : filteredTargets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
          <SearchX className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No accounts match{query.trim() ? <> &ldquo;{query.trim()}&rdquo;</> : " this filter"}.
          </p>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setQuery(""); setStatusFilter("all"); }} >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="md:hidden">
            <div className="flex h-9 items-center gap-3 border-b bg-muted/40 px-3 text-xs text-muted-foreground">
              <Checkbox checked={headerChecked} onCheckedChange={toggleAllVisible} aria-label="Select all" />
              <span>
                {selected.size > 0 ? `${selected.size} selected` : `${filteredTargets.length} accounts`}
              </span>
            </div>
            <ul className="divide-y">
              {filteredTargets.map((target) => {
                const snap = target.snapshots?.[0];
                const isSelected = selected.has(target.id);
                const followers = compactCount(snap?.followersCount);
                return (
                  <li key={target.id}
                    className={cn("flex items-center gap-3 px-3 py-2.5", isSelected && "bg-muted/60")}
                    onTouchStart={() => prefetchTargetDetail(target.id)}
                  >
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleOne(target.id)}
                      aria-label={`Select @${target.username}`}
                    />
                    <Link
                      href={`/targets/${target.id}`}
                      onMouseEnter={() => prefetchTargetDetail(target.id)}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <TargetAvatar username={target.username} src={snap?.profilePictureStorageUrl} className="size-9">
                        <span className={cn("absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-card",
                          targetStatusInfo(target.status).dotClass,
                        )} aria-hidden />
                      </TargetAvatar>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">@{target.username}</span>
                          {target.monitor?.purpose === "TREND" && <TrendTag />}
                        </span>
                        {/* shortAgo() and the compact follower count are computed from "now"/the
                            runtime locale, which can differ by a beat between the server render
                            and hydration — expected, not a real mismatch, so don't warn on it. */}
                        <span className="block truncate text-xs text-muted-foreground" suppressHydrationWarning>
                          {targetStatusInfo(target.status).label}{" · "}
                          {shortAgo(target.lastCheckedAt)}
                          {` · ${plural(target._count?.events ?? 0, "event")}`}
                          {followers && ` · ${followers} followers`}
                        </span>
                      </span>
                    </Link>
                    {rowMenu(target)}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Laptop: slim table */}
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="h-9 whitespace-nowrap border-b bg-muted/40 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <th className="w-10 pl-4">
                  <Checkbox checked={headerChecked} onCheckedChange={toggleAllVisible} aria-label="Select all" />
                </th>
                <th className="px-2 font-medium">Account</th>
                <th className="px-2 font-medium">Status</th>
                <th className="hidden px-2 font-medium lg:table-cell">Interval</th>
                <th className="px-2 font-medium">Last checked</th>
                <th className="px-2 text-right font-medium">Events</th>
                <th className="w-20 pr-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredTargets.map((target) => {
                const snap = target.snapshots?.[0];
                const isSelected = selected.has(target.id);
                const followers = compactCount(snap?.followersCount);
                const subline = [snap?.name, followers && `${followers} followers`].filter(Boolean).join(" · ");
                return (
                  <tr key={target.id} data-state={isSelected ? "selected" : undefined}
                    onClick={() => router.push(`/targets/${target.id}`)}
                    onMouseEnter={() => prefetchTargetDetail(target.id)}
                    className="group h-12 cursor-pointer transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted/60"
                  >
                    <td className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={isSelected}
                        onCheckedChange={() => toggleOne(target.id)}
                        aria-label={`Select @${target.username}`}
                      />
                    </td>
                    <td className="w-full max-w-0 px-2">
                      <div className="flex items-center gap-2.5">
                        <TargetAvatar username={target.username} src={snap?.profilePictureStorageUrl} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Link href={`/targets/${target.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="truncate font-medium hover:underline" >
                              @{target.username}
                            </Link>
                            {target.monitor?.purpose === "TREND" && <TrendTag />}
                          </div>
                          {/* Contains the locale-formatted follower count — see the mobile row's note above. */}
                          {subline && (
                            <div className="truncate text-xs text-muted-foreground" suppressHydrationWarning>
                              {subline}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-2">
                      <TargetStatusDot status={target.status} nextRunAt={target.nextRunAt} errorMessage={target.errorMessage} />
                    </td>
                    <td className="hidden whitespace-nowrap px-2 text-xs tabular-nums text-muted-foreground lg:table-cell">
                      {target.monitor?.active ? `Every ${formatInterval(target.monitor?.intervalSeconds)}` : "—"}
                    </td>
                    {/* shortAgo() reads Date.now() — see the mobile row's note above. */}
                    <td className="whitespace-nowrap px-2 text-xs tabular-nums text-muted-foreground"
                      title={target.lastCheckedAt ? new Date(target.lastCheckedAt).toLocaleString() : undefined}
                      suppressHydrationWarning
                    >
                      {shortAgo(target.lastCheckedAt)}
                    </td>
                    <td className="px-2 text-right text-xs tabular-nums text-muted-foreground">
                      {target._count?.events ?? 0}
                    </td>
                    <td className="pr-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="icon" disabled={busyId === target.id}
                          onClick={() => togglePause(target.id, !target.monitor?.active)}
                          title={target.monitor?.active ? "Pause" : "Resume"}
                          aria-label={target.monitor?.active ? `Pause @${target.username}` : `Resume @${target.username}`}
                          className="size-8 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          {target.monitor?.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                        </Button>
                        {rowMenu(target)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Floating bulk-action bar */}
      {selected.size > 0 && (
        <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-3 z-30mx-auto flex w-fit max-w-full items-center gap-1 rounded-full border bg-popover/95 p-1 pl-3 shadow-lg backdrop-blur">
          <span className="mr-1 whitespace-nowrap text-xs font-medium tabular-nums">{selected.size} selected</span>
          <Button size="sm" variant="ghost" className="h-8 rounded-full" disabled={bulkBusy}
            onClick={() => bulkAction("pause")} aria-label="Pause selected" >
            <Pause /> <span className="hidden sm:inline">Pause</span>
          </Button>
          <Button size="sm" variant="ghost" className="h-8 rounded-full" disabled={bulkBusy}
            onClick={() => bulkAction("resume")} aria-label="Resume selected"          >
            <Play /> <span className="hidden sm:inline">Resume</span>
          </Button>
          <Button size="sm" variant="ghost"
            className="h-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={bulkBusy} onClick={() => bulkAction("delete")} aria-label="Delete selected"
          >
            <Trash2 /> <span className="hidden sm:inline">Delete</span>
          </Button>
          <Button size="icon" variant="ghost" className="size-8 rounded-full"
            disabled={bulkBusy} onClick={() => setSelected(new Set())} aria-label="Clear selection"
          >
            <X />
          </Button>
        </div>
      )}

      <DeleteTargetDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        targets={deleting ?? []}
        onOptimisticDelete={(ids) => {
          removeOptimistically(new Set(ids));
          setSelected(new Set());
        }}
        onDeleted={() => {
          refresh(); // reconciles the optimistic removal; brings back any survivor of a partial bulk failure
          refreshQuota();
        }}
        onDeleteFailed={() => {
          refresh(); // undo: nothing was actually deleted, restore the real list
          refreshQuota();
        }}
      />
    </div>
  );
}

function TrendTag() {
  return (
    <span className="shrink-0 rounded bg-violet-500/10 px-1 py-px text-[10px] font-medium text-violet-600 dark:text-violet-400">
      Trend
    </span>
  );
}
