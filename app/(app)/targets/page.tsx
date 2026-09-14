"use client";
import Link from "next/link";
import { toast } from "sonner";
import { useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { useTargets } from "@/hooks/use-targets";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/domain/empty-state";
import { LoadingState } from "@/components/domain/loading-state";
import { TargetStatusBadge } from "@/components/domain/target-status-badge";
import { Plus, Radar, MoreVertical, Pause, Play, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function TargetsPage() {
  const router = useRouter();
  const { targets, loading, error, refresh } = useTargets();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function togglePause(targetId: string, active: boolean) {
    setBusyId(targetId);
    try {
      await apiFetch(`/api/targets/${targetId}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      toast.success(active ? "Monitoring resumed." : "Monitoring paused.");
      refresh();
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Targets</h1>
          <p className="text-sm text-muted-foreground">Accounts you&apos;re monitoring for changes.</p>
        </div>
        <Button asChild>
          <Link href="/targets/new">
            <Plus /> Add target
          </Link>
        </Button>
      </div>

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
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last checked</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {targets.map((target) => (
                  <TableRow key={target.id}>
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
                      <TargetStatusBadge status={target.status} />
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
