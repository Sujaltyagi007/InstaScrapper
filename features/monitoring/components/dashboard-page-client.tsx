"use client";
import { AppLink } from "@/features/shell/navigation";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/common/error-state";
import { EmptyState } from "@/components/common/empty-state";
import { LoadingState } from "@/components/common/loading-state";
import { useTargets } from "@/features/targets/hooks/use-targets";
import { useEvents } from "@/features/monitoring/hooks/use-events";
import { useMetaStatus } from "@/features/account/hooks/use-meta-status";
import { Radar, Bell, AlertTriangle, Activity, Plus } from "lucide-react";
import { EventTypeBadge } from "@/features/monitoring/components/event-type-badge";
import { TargetStatusBadge } from "@/features/targets/components/target-status-badge";
import { SystemHealthBadge } from "@/features/monitoring/components/system-health-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";



const DashboardPageCardsData = [
  {
    title: "Targets monitored",
    icon: <Radar className="size-4 text-muted-foreground" />,
    value: (targets: any) => targets?.length ?? "—",
  },
  {
    title: "Actively polling",
    icon: <Activity className="size-4 text-muted-foreground" />,
    value: (targets: any) => targets?.filter((t: any) => t.status === "ACTIVE").length ?? "—",
  },
  {
    title: "Need attention",
    icon: <Bell className="size-4 text-muted-foreground" />,
    value: (targets: any) =>
      targets?.filter((t: any) => ["AUTH_ERROR", "REAUTH_REQUIRED", "NOT_FOUND", "UNAVAILABLE"].includes(t.status)).length ?? "—",
  },
];

export function DashboardPageClient() {
  const { targets, loading: targetsLoading } = useTargets();
  const { events, loading: eventsLoading, error: eventsError, refresh: refreshEvents } = useEvents();
  const { metaStatus } = useMetaStatus();
  const metaMock = metaStatus?.mock ?? false;

  const activeCount = targets?.filter((t) => t.status === "ACTIVE").length ?? 0;
  const attentionCount = targets?.filter((t) => ["AUTH_ERROR", "REAUTH_REQUIRED", "NOT_FOUND", "UNAVAILABLE"].includes(t.status)).length ?? 0;

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
          <AppLink to={{ tab: "targets", view: { kind: "new" } }}>
            <Plus /> Add target
          </AppLink>
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
        {DashboardPageCardsData.map((card) => (
          <Card key={card.title} className="flex flex-row justify-between pr-2 md:px-0 items-baseline  " >
            <CardHeader className="flex-row items-end justify-between space-y-0 pb-2">
              <div className="flex items-center gap-2">
                {card.icon}
                <CardTitle className="text-sm font-medium text-nowrap text-muted-foreground">{card.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{card.value(targets)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>The latest detected changes across all your targets.</CardDescription>
        </CardHeader>
        <CardContent>
          {eventsLoading && !events ? (<LoadingState rows={4} />) : eventsError && !events ? (
            <ErrorState title="Couldn't load recent activity" message={eventsError} onRetry={refreshEvents} />
          ) : !events || events.length === 0 ? (
            <EmptyState icon={Bell} title="No activity yet"
              description="Once you add a target, detected changes will show up here."
            />
          ) : (
            <ul className="divide-y">
              {events.slice(0, 10).map((event) => {
                const afterData = event.after as { storageUrl?: string; mediaUrl?: string; caption?: string } | null;
                const mediaPreview = afterData?.storageUrl || afterData?.mediaUrl;
                const captionText = afterData?.caption;

                return (
                  <li key={event.id} className="flex flex-col gap-2 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <EventTypeBadge type={event.type} />
                        <AppLink to={{ tab: "targets", view: { kind: "target", id: event.target.id } }} className="text-sm font-semibold hover:underline">
                          @{event.target.username}
                        </AppLink>
                      </div>
                      {/* Relative to "now" — differs by a beat between the server render and hydration; expected. */}
                      <span className="text-xs text-muted-foreground" suppressHydrationWarning>
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
                  <AppLink to={{ tab: "targets", view: { kind: "target", id: target.id } }} className="text-sm font-medium hover:underline">
                    @{target.username}
                  </AppLink>
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
