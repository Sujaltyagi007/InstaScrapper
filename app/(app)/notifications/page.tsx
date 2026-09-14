"use client";
import { useState } from "react";
import { Plus, Bell, MoreVertical, Trash2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNotificationChannels } from "@/hooks/use-notification-channels";
import { LoadingState } from "@/components/domain/loading-state";
import { EmptyState } from "@/components/domain/empty-state";
import { CreateChannelDialog } from "@/components/domain/create-channel-dialog";
import { apiFetch } from "@/lib/fetcher";
import { toast } from "sonner";

const PROVIDER_LABELS: Record<string, string> = {
  DISCORD: "Discord",
  NTFY: "ntfy",
  WEBHOOK: "Generic webhook",
};

export default function NotificationsPage() {
  const { channels, loading, error, refresh } = useNotificationChannels();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleEnabled(id: string, enabled: boolean) {
    setBusyId(id);
    try {
      await apiFetch(`/api/notification-channels/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update channel.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this notification channel?")) return;
    setBusyId(id);
    try {
      await apiFetch(`/api/notification-channels/${id}`, { method: "DELETE" });
      toast.success("Channel deleted.");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete channel.");
    } finally {
      setBusyId(null);
    }
  }

  async function sendTest(id: string) {
    setBusyId(id);
    try {
      await apiFetch(`/api/notification-channels/${id}/test`, { method: "POST" });
      toast.success("Test notification sent.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send test notification.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">Channels that receive alerts when changes are detected.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus /> Add channel
        </Button>
      </div>

      <Card>
        <CardContent className="px-0 sm:px-6">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <p className="p-6 text-sm text-destructive">{error}</p>
          ) : !channels || channels.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No notification channels"
              description="Add Discord, ntfy, or a webhook to get alerted about changes."
              actionLabel="Add channel"
              onAction={() => setDialogOpen(true)}
            />
          ) : (
            <ul className="divide-y">
              {channels.map((channel) => (
                <li key={channel.id} className="flex items-center justify-between gap-3 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{channel.name}</p>
                      <Badge variant="outline">{PROVIDER_LABELS[channel.provider]}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {channel.eventTypeFilter.length === 0
                        ? "All event types"
                        : `${channel.eventTypeFilter.length} event type(s)`}
                      {channel.cooldownSeconds > 0 && ` · ${channel.cooldownSeconds}s cooldown`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={channel.enabled}
                      disabled={busyId === channel.id}
                      onCheckedChange={(v) => toggleEnabled(channel.id, v)}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={busyId === channel.id}>
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => sendTest(channel.id)}>
                          <Send /> Send test
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => remove(channel.id)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <CreateChannelDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={refresh} />
    </div>
  );
}
