"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useTargetDetail } from "@/features/targets/hooks/use-target-detail";
import { LoadingState } from "@/components/common/loading-state";
import { EmptyState } from "@/components/common/empty-state";
import { TargetStatusBadge } from "@/features/targets/components/target-status-badge";
import { EventTypeBadge } from "@/features/monitoring/components/event-type-badge";
import { MediaGallery } from "@/features/targets/components/media-gallery";
import { apiFetch } from "@/lib/fetcher";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";

export default function TargetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { target, loading, error, refresh } = useTargetDetail(id);
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Profile snapshot</CardTitle>
              <CardDescription>
                {snapshot
                  ? `Last captured ${formatDistanceToNow(new Date(snapshot.capturedAt), { addSuffix: true })}`
                  : "No data captured yet — this appears after the first scheduled check."}
              </CardDescription>
            </CardHeader>
            {snapshot && (
              <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Stat label="Followers" value={snapshot.followersCount ?? "—"} />
                <Stat label="Following" value={snapshot.followsCount ?? "—"} />
                <Stat label="Posts" value={snapshot.mediaCount ?? "—"} />
                <Stat label="Reels" value={snapshot.reelsCount ?? "—"} />
                <Stat
                  label="Active Story"
                  value={snapshot.hasStory ? `Yes (${snapshot.storiesCount ?? 1})` : "No"}
                />
                <Stat
                  label="Last checked"
                  value={target.lastCheckedAt ? formatDistanceToNow(new Date(target.lastCheckedAt), { addSuffix: true }) : "—"}
                />
                {snapshot.biography && (
                  <p className="col-span-full text-sm text-muted-foreground">{snapshot.biography}</p>
                )}
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Scraped Media & Captions</CardTitle>
              <CardDescription>
                High-definition posts, reels, and stories stored on ImageKit.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MediaGallery media={target.media || []} username={target.username} />
            </CardContent>
          </Card>

          <Card>
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
                    <li key={event.id} className="flex items-center justify-between gap-3 py-3">
                      <EventTypeBadge type={event.type} />
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(event.detectedAt), "MMM d, yyyy 'at' h:mm a")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Monitor settings</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ToggleRow
              label="Active"
              checked={Boolean(target.monitor?.active)}
              disabled={saving}
              onCheckedChange={(v) => updateMonitor({ active: v })}
            />
            <Separator />
            <ToggleRow
              label="New posts & reels"
              checked={Boolean(target.monitor?.watchNewMedia)}
              disabled={saving}
              onCheckedChange={(v) => updateMonitor({ watchNewMedia: v })}
            />
            <ToggleRow
              label="Stories"
              checked={Boolean(target.monitor?.watchStories)}
              disabled={saving}
              onCheckedChange={(v) => updateMonitor({ watchStories: v })}
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
              label="Follower churn detection"
              checked={Boolean(target.monitor?.watchFollowerChurn)}
              disabled={saving}
              onCheckedChange={(v) => updateMonitor({ watchFollowerChurn: v })}
            />
            <ToggleRow
              label="Anti-bot jitter"
              checked={Boolean(target.monitor?.jitterEnabled)}
              disabled={saving}
              onCheckedChange={(v) => updateMonitor({ jitterEnabled: v })}
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
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm font-medium">{label}</p>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}
