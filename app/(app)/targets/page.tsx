"use client";
import Link from "next/link";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useTargets } from "@/features/targets/hooks/use-targets";
import { useTargetQuota } from "@/features/account/hooks/use-target-quota";
import { TargetQuotaBanner } from "@/features/account/components/target-quota-banner";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { LoadingState } from "@/components/common/loading-state";
import { TargetStatusBadge } from "@/features/targets/components/target-status-badge";
import { Plus, Radar, MoreVertical, Pause, Play, Trash2, Search, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
  { value: "attention", label: "Needs attention" },
  { value: "DISCOVERED", label: "Discovered" },
];

export default function TargetsPage() {
  const router = useRouter();
  const { targets, loading, error, refresh } = useTargets();
  const { quota, refresh: refreshQuota } = useTargetQuota();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filteredTargets = useMemo(() => {
    if (!targets) return [];
    const q = query.trim().toLowerCase();
    return targets.filter((target) => {
      const matchesQuery = !q || target.username.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "attention" ? ATTENTION_STATUSES.has(target.status) : target.status === statusFilter);
      return matchesQuery && matchesStatus;
    });
  }, [targets, query, statusFilter]);

  const allVisibleSelected = filteredTargets.length > 0 && filteredTargets.every((t) => selected.has(t.id));
  const someVisibleSelected = filteredTargets.some((t) => selected.has(t.id));

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
      if (allVisibleSelected) {
        filteredTargets.forEach((t) => next.delete(t.id));
      } else {
        filteredTargets.forEach((t) => next.add(t.id));
      }
      return next;
    });
  }

  async function togglePause(targetId: string, active: boolean) {
    setBusyId(targetId);
    try {
      await apiFetch(`/api/targets/${targetId}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      toast.success(active ? "Monitoring resumed." : "Monitoring paused.");
      refresh();
      refreshQuota();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(targetId: string) {
    if (!confirm("Delete this target and all its history? This cannot be undone.")) return;
    setBusyId(targetId);
    try {
      await apiFetch(`/api/targets/${targetId}`, { method: "DELETE" });
      toast.success("Target deleted.");
      refresh();
      refreshQuota();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  async function bulkAction(action: "pause" | "resume" | "delete") {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (action === "delete" && !confirm(`Delete ${ids.length} target${ids.length > 1 ? "s" : ""} and all their history? This cannot be undone.`)) {
      return;
    }
    setBulkBusy(true);
    try {
      const data = await apiFetch<{ count: number; total: number }>("/api/targets/bulk", {
        method: "POST",
        body: JSON.stringify({ ids, action }),
      });
      const verb = action === "delete" ? "deleted" : action === "pause" ? "paused" : "resumed";
      if (data.count < data.total) {
        toast.warning(`${data.count} of ${data.total} target${data.total === 1 ? "" : "s"} ${verb}; the rest failed.`);
      } else {
        toast.success(`${data.count} target${data.count === 1 ? "" : "s"} ${verb}.`);
      }
      setSelected(new Set());
      refresh();
      refreshQuota();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Targets</h1>
          <p className="text-sm text-muted-foreground">
            Accounts you&apos;re monitoring for changes.
            {quota && ` ${quota.used} of ${quota.limit} used.`}
          </p>
        </div>
        {quota?.level === "FULL" ? (
          <Button disabled title="Account limit reached">
            <Plus /> Add target
          </Button>
        ) : (
          <Button asChild>
            <Link href="/targets/new">
              <Plus /> Add target
            </Link>
          </Button>
        )}
      </div>

      <TargetQuotaBanner quota={quota} />

      {targets && targets.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-50">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by username…"
              className="pl-8"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-45">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkAction("pause")}>
              <Pause /> Pause
            </Button>
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkAction("resume")}>
              <Play /> Resume
            </Button>
            <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={() => bulkAction("delete")}>
              <Trash2 /> Delete
            </Button>
            <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
              <X /> Clear
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="px-0 sm:px-6">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <p className="p-6 text-sm text-destructive">{error}</p>
          ) : !targets || targets.length === 0 ? (
            <EmptyState
              icon={Radar}
              title="No targets yet"
              description="Add a public Instagram account to start monitoring it for changes."
              actionLabel="Add target"
              onAction={() => router.push("/targets/new")}
            />
          ) : filteredTargets.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No targets match your search or filter.</p>
          ) : (
            <>
              {/* Mobile View */}
              <div className="divide-y md:hidden">
                {filteredTargets.map((target) => (
                  <div key={target.id} className="flex items-center gap-3 p-4">
                    <Checkbox checked={selected.has(target.id)} onCheckedChange={() => toggleOne(target.id)} />
                    <div className="flex flex-1 items-center justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Link href={`/targets/${target.id}`} className="font-semibold text-sm hover:underline">
                            @{target.username}
                          </Link>
                          {target.monitor?.engineType === "STEALTH_SCRAPER" && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              Stealth
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <TargetStatusBadge
                            status={target.status}
                            nextRunAt={target.nextRunAt}
                            errorMessage={target.errorMessage}
                          />
                          <span>·</span>
                          <span>{target._count?.events ?? 0} events</span>
                        </div>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" disabled={busyId === target.id} className="size-8">
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {target.monitor?.active ? (
                            <DropdownMenuItem onSelect={() => togglePause(target.id, false)}>
                              <Pause /> Pause
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => togglePause(target.id, true)}>
                              <Play /> Resume
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem variant="destructive" onSelect={() => remove(target.id)}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                          onCheckedChange={toggleAllVisible}
                        />
                      </TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last checked</TableHead>
                      <TableHead>Events</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTargets.map((target) => (
                      <TableRow key={target.id}>
                        <TableCell>
                          <Checkbox checked={selected.has(target.id)} onCheckedChange={() => toggleOne(target.id)} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Link href={`/targets/${target.id}`} className="font-medium hover:underline">
                              @{target.username}
                            </Link>
                            {target.monitor?.engineType === "STEALTH_SCRAPER" && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                                Stealth
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <TargetStatusBadge
                            status={target.status}
                            nextRunAt={target.nextRunAt}
                            errorMessage={target.errorMessage}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {target.lastCheckedAt
                            ? formatDistanceToNow(new Date(target.lastCheckedAt), { addSuffix: true })
                            : "Never"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{target._count?.events ?? 0}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" disabled={busyId === target.id}>
                                <MoreVertical className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {target.monitor?.active ? (
                                <DropdownMenuItem onSelect={() => togglePause(target.id, false)}>
                                  <Pause /> Pause
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onSelect={() => togglePause(target.id, true)}>
                                  <Play /> Resume
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem variant="destructive" onSelect={() => remove(target.id)}>
                                <Trash2 /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
