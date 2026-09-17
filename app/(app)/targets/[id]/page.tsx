"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTargetDetail } from "@/features/targets/hooks/use-target-detail";
import { useSessions } from "@/features/sessions/hooks/use-sessions";
import { LoadingState } from "@/components/common/loading-state";
import { EmptyState } from "@/components/common/empty-state";
import { TargetStatusBadge } from "@/features/targets/components/target-status-badge";
import { EventTypeBadge } from "@/features/monitoring/components/event-type-badge";
import { InstagramSimulator } from "@/features/targets/components/instagram-simulator";
import { apiFetch } from "@/lib/fetcher";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";

import { MediaGallery } from "@/features/targets/components/media-gallery";
import { Download, HardDrive, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function TargetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { target, loading, error, refresh } = useTargetDetail(id);
  const { sessions } = useSessions();
  const [saving, setSaving] = useState(false);
  const activeSessions = (sessions ?? []).filter((s) => s.status === "ACTIVE");

  async function updateMonitor(updates: Record<string, unknown>) {
    setSaving(true);
    try {
      await apiFetch(`/api/targets/${id}`, { method: "PATCH", body: JSON.stringify(updates) });
      toast.success("Settings updated.");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this target and all its history? This cannot be undone.")) return;
    try {
      await apiFetch(`/api/targets/${id}`, { method: "DELETE" });
      toast.success("Target deleted.");
      router.push("/targets");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete target.");
    }
  }

  if (loading) return <LoadingState />;
  if (error || !target) {
    return (
      <div className="flex flex-col gap-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href="/targets">
            <ArrowLeft /> Back to targets
          </Link>
        </Button>
        <p className="text-sm text-destructive">{error ?? "Target not found."}</p>
      </div>
    );
  }

  const snapshot = target.snapshots[0];
  const downloadedMediaCount = target.media?.length ?? 0;

  return (
    <div className="flex-1 h-full min-h-0 overflow-hidden flex flex-col">
      <div className="grid grid-cols-1 lg:grid-cols-24 gap-8 h-full min-h-0 items-stretch overflow-hidden">
        <div className="lg:col-span-16 flex flex-col gap-6 w-full min-w-0 h-full overflow-y-auto pr-3 custom-scrollbar">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4 shrink-0">
            <div>
              <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
                <Link href="/targets">
                  <ArrowLeft className="size-4 mr-1" /> Back to targets
                </Link>
              </Button>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">@{target.username}</h1>
                <TargetStatusBadge status={target.status} />
              </div>
              {target.errorMessage && <p className="mt-1 text-sm text-destructive">{target.errorMessage}</p>}
            </div>
            <Button variant="outline" size="sm" onClick={remove} className="self-start sm:self-auto text-destructive hover:bg-destructive/10">
              <Trash2 className="size-4 mr-1.5" /> Delete target
            </Button>
          </div>

          {/* Monitor Settings */}
          <Card className="h-fit shrink-0">
            <CardHeader>
              <CardTitle>Monitor settings</CardTitle>
              <CardDescription>Configure auto-scraping and alert options for @{target.username}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ToggleRow
                label="Active"
                checked={Boolean(target.monitor?.active)}
                disabled={saving}
                onCheckedChange={(v) => updateMonitor({ active: v })}
              />
              <Separator />

              <div className="flex flex-col gap-1.5">
                <Label>Instagram session</Label>
                <Select
                  value={target.monitor?.instagramSessionId ?? "none"}
                  disabled={saving}
                  onValueChange={(v) =>
                    v === "none"
                      ? updateMonitor({
                        instagramSessionId: null,
                        watchStories: false,
                        watchFollowerChurn: false,
                        watchFollowingCount: false,
                      })
                      : updateMonitor({ instagramSessionId: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None (anonymous)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (anonymous)</SelectItem>
                    {activeSessions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        @{s.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2">
                Basic (no login required)
              </p>
              <ToggleRow
                label="New posts & reels (Auto-download HD media)"
                checked={Boolean(target.monitor?.watchNewMedia)}
                disabled={saving}
                onCheckedChange={(v) => updateMonitor({ watchNewMedia: v })}
              />
              <ToggleRow
                label="Reels count"
                checked={Boolean(target.monitor?.watchReels)}
                disabled={saving}
                onCheckedChange={(v) => updateMonitor({ watchReels: v })}
              />
              <ToggleRow
                label="Profile changes"
                checked={Boolean(target.monitor?.watchProfile)}
                disabled={saving}
                onCheckedChange={(v) => updateMonitor({ watchProfile: v })}
              />
              <ToggleRow
                label="Follower count"
                checked={Boolean(target.monitor?.watchFollowerCount)}
                disabled={saving}
                onCheckedChange={(v) => updateMonitor({ watchFollowerCount: v })}
              />
              <ToggleRow
                label="Anti-bot jitter"
                checked={Boolean(target.monitor?.jitterEnabled)}
                disabled={saving}
                onCheckedChange={(v) => updateMonitor({ jitterEnabled: v })}
              />

              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2">
                Advanced (requires an Instagram session)
              </p>
              <ToggleRow
                label="Stories"
                checked={Boolean(target.monitor?.watchStories)}
                disabled={saving || !target.monitor?.instagramSessionId}
                locked={!target.monitor?.instagramSessionId}
                onCheckedChange={(v) => updateMonitor({ watchStories: v })}
              />
              <ToggleRow
                label="Follower & following changes"
                checked={Boolean(target.monitor?.watchFollowerChurn)}
                disabled={saving || !target.monitor?.instagramSessionId}
                locked={!target.monitor?.instagramSessionId}
                onCheckedChange={(v) => updateMonitor({ watchFollowerChurn: v })}
              />
              <ToggleRow
                label="Following count"
                checked={Boolean(target.monitor?.watchFollowingCount)}
                disabled={saving || !target.monitor?.instagramSessionId}
                locked={!target.monitor?.instagramSessionId}
                onCheckedChange={(v) => updateMonitor({ watchFollowingCount: v })}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="interval">Check every (minutes)</Label>
                <Input
                  id="interval"
                  type="number"
                  min={5}
                  defaultValue={Math.round((target.monitor?.intervalSeconds ?? 5400) / 60)}
                  onBlur={(e) => updateMonitor({ intervalSeconds: Number(e.target.value) * 60 })}
                />
              </div>
              {saving && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Saving...
                </p>
              )}
            </CardContent>
          </Card>

          {/* Auto-Downloaded Media Option & Gallery */}
          <Card className="shrink-0">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <HardDrive className="size-5 text-primary" />
                  <span>Auto-Downloaded Media</span>
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {downloadedMediaCount} item{downloadedMediaCount === 1 ? "" : "s"}
                  </Badge>
                </CardTitle>
                <CardDescription className="mt-1">
                  High-res images, reels, and stories automatically fetched and backed up to cloud storage.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <MediaGallery
                media={target.media || []}
                username={target.username}
                onMediaChanged={refresh}
              />
            </CardContent>
          </Card>

          {/* Event History */}
          <Card className="shrink-0 pb-4">
            <CardHeader>
              <CardTitle>Event history</CardTitle>
              <CardDescription>Changes detected for this account.</CardDescription>
            </CardHeader>
            <CardContent>
              {target.events.length === 0 ? (
                <EmptyState icon={Bell} title="No events yet" description="Detected changes will appear here." />
              ) : (
                <ul className="divide-y">
                  {target.events.map((event) => (
                    <li key={event.id} className="flex flex-col gap-1 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <EventTypeBadge type={event.type} />
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(event.detectedAt), "MMM d, yyyy 'at' h:mm a")}
                        </span>
                      </div>
                      {event.type === "FOLLOWER_CHURN" && (
                        <p className="text-xs text-muted-foreground">{formatChurnSummary(event.after)}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-8 w-full flex flex-col items-center justify-start h-full min-h-0 overflow-hidden shrink-0 z-10">
          <div className="w-full max-w-sm mb-2 flex items-center justify-between px-1 text-xs text-muted-foreground shrink-0">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
              </span>
              Target Simulator
            </span>
            <span className="text-[11px] bg-muted/80 border px-2 py-0.5 rounded-full font-mono">Fixed View</span>
          </div>
          <InstagramSimulator
            snapshot={snapshot}
            media={target.media || []}
            username={target.username}
            targetId={id}
            onDataChanged={refresh}
          />
        </div>
      </div>
    </div>
  );
}

function formatChurnSummary(after: unknown): string {
  const a = (after ?? {}) as {
    followersAdded?: unknown[];
    followersRemoved?: unknown[];
    followingAdded?: unknown[];
    followingRemoved?: unknown[];
  };
  const parts: string[] = [];
  if (a.followersAdded?.length) parts.push(`+${a.followersAdded.length} follower${a.followersAdded.length === 1 ? "" : "s"}`);
  if (a.followersRemoved?.length) parts.push(`−${a.followersRemoved.length} follower${a.followersRemoved.length === 1 ? "" : "s"}`);
  if (a.followingAdded?.length) parts.push(`+${a.followingAdded.length} following`);
  if (a.followingRemoved?.length) parts.push(`−${a.followingRemoved.length} following`);
  return parts.length > 0 ? parts.join(" · ") : "No change details recorded.";
}

function ToggleRow({
  label,
  checked,
  disabled,
  locked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  locked?: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {label}
          {locked && <Lock className="size-3 text-muted-foreground" />}
        </p>
        {locked && <p className="text-xs text-muted-foreground">Requires an Instagram session.</p>}
      </div>
      <Switch checked={locked ? false : checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}
