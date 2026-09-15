"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTargets } from "@/features/targets/hooks/use-targets";
import { useEvents } from "@/features/monitoring/hooks/use-events";
import { formatDistanceToNow } from "date-fns";
import { EmptyState } from "@/components/common/empty-state";
import { LoadingState } from "@/components/common/loading-state";
import { EventTypeBadge } from "@/features/monitoring/components/event-type-badge";
import { TargetStatusBadge } from "@/features/targets/components/target-status-badge";
import { Radar, Bell, AlertTriangle, Activity, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SystemHealthBadge } from "@/features/monitoring/components/system-health-badge";

export default function DashboardPage() {
  const { targets, loading: targetsLoading } = useTargets();
  const { events, loading: eventsLoading } = useEvents();
  const [metaMock, setMetaMock] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/meta/status")
      .then((r) => r.json())
      .then((d) => setMetaMock(Boolean(d.mock)))
      .catch(() => undefined);
  }, []);

  const activeCount = targets?.filter((t) => t.status === "ACTIVE").length ?? 0;
  const attentionCount =
    targets?.filter((t) => ["AUTH_ERROR", "REAUTH_REQUIRED", "NOT_FOUND", "UNAVAILABLE"].includes(t.status))
      .length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground">An overview of everything you&apos;re monitoring.</p>
          </div>
          <div className="hidden sm:block w-48 relative">
            <SystemHealthBadge direction="down" />
          </div>
        </div>
        <Button asChild>
          <Link href="/targets/new">
            <Plus /> Add target
          </Link>
        </Button>
      </div>

      {metaMock && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="size-4 shrink-0 text-warning-foreground" />
            <p className="text-sm">
              Running in <span className="font-medium">mock mode</span> — Instagram data is simulated because no
              real Meta Developer App credentials are configured yet. See Settings to learn more.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Targets monitored</CardTitle>
            <Radar className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{targets?.length ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Actively polling</CardTitle>
            <Activity className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{activeCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Need attention</CardTitle>
            <Bell className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{attentionCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>The latest detected changes across all your targets.</CardDescription>
        </CardHeader>
        <CardContent>
          {eventsLoading ? (
            <LoadingState />
          ) : !events || events.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No activity yet"
              description="Once you add a target, detected changes will show up here."
            />
          ) : (
            <ul className="divide-y">
              {events.slice(0, 10).map((event) => {
                const afterData = event.after as Record<string, any> | null;
                const mediaPreview = afterData?.storageUrl || afterData?.mediaUrl;
                const captionText = afterData?.caption;

                return (
                  <li key={event.id} className="flex flex-col gap-2 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <EventTypeBadge type={event.type} />
                        <Link href={`/targets/${event.target.id}`} className="text-sm font-semibold hover:underline">
                          @{event.target.username}
                        </Link>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(event.detectedAt), { addSuffix: true })}
                      </span>
                    </div>

                    {(mediaPreview || captionText) && (
                      <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-2.5 ml-1">
                        {mediaPreview && (
                          <div className="relative size-12 shrink-0 overflow-hidden rounded border bg-black/10">
                            <img
                              src={mediaPreview}
                              alt="Scraped media preview"
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          {captionText ? (
                            <p className="text-xs text-foreground/90 line-clamp-2 leading-relaxed">
                              {captionText}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">No caption</p>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {!targetsLoading && targets && targets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Your targets</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {targets.slice(0, 6).map((target) => (
                <li key={target.id} className="flex items-center justify-between gap-3 py-3">
                  <Link href={`/targets/${target.id}`} className="text-sm font-medium hover:underline">
                    @{target.username}
                  </Link>
                  <TargetStatusBadge status={target.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
