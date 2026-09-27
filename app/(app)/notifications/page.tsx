"use client";
import { friendlyError } from "@/lib/friendly-error";
import { useState } from "react";
import { Plus, Bell, MoreVertical, Trash2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNotificationChannels } from "@/features/notifications/hooks/use-notification-channels";
import { LoadingState } from "@/components/common/loading-state";
import { ErrorState } from "@/components/common/error-state";
import { EmptyState } from "@/components/common/empty-state";
import { CreateChannelDialog } from "@/features/notifications/components/create-channel-dialog";
import { apiFetch } from "@/lib/fetcher";
import { mutate as globalMutate } from "swr";
import { PUSH_KEY } from "@/lib/swr-keys";
import { PushNotificationsCard } from "@/features/notifications/components/push-notifications-card";
import { toast } from "sonner";

const PROVIDER_LABELS: Record<string, string> = {
  DISCORD: "Discord",
  NTFY: "ntfy",
  WEBHOOK: "Generic webhook",
  WEBPUSH: "Browser push",
};

export default function NotificationsPage() {
  const { channels, loading, error, refresh, mutate } = useNotificationChannels();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Optimistic: the switch flips / the row disappears at once; a failure re-fetches the real list.
  async function toggleEnabled(id: string, enabled: boolean) {
    mutate(
      (cur) => cur && { channels: cur.channels.map((c) => (c.id === id ? { ...c, enabled } : c)) },
      { revalidate: false },
    );
    try {
      await apiFetch(`/api/notification-channels/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
      globalMutate(PUSH_KEY);
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't update that channel."));
      refresh();
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this notification channel?")) return;
    mutate((cur) => cur && { channels: cur.channels.filter((c) => c.id !== id) }, { revalidate: false });
    try {
      await apiFetch(`/api/notification-channels/${id}`, { method: "DELETE" });
      globalMutate(PUSH_KEY);
      toast.success("Channel deleted.");
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't delete that channel."));
      refresh();
    }
  }

  async function sendTest(id: string) {
    setBusyId(id);
    try {
      await apiFetch(`/api/notification-channels/${id}/test`, { method: "POST" });
      toast.success("Test notification sent.");
    } catch (err) {
      toast.error(friendlyError(err, "Failed to send test notification."));
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

      <PushNotificationsCard />

      <Card>
        <CardContent className="px-0 sm:px-6">
          {loading && !channels ? (
            <LoadingState rows={3} className="px-4 sm:px-0" />
          ) : error && !channels ? (
            <ErrorState title="Couldn't load your channels" message={error} onRetry={refresh} className="m-4 sm:m-0" />
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
                <li key={channel.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:px-6">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-sm">{channel.name}</p>
                      <Badge variant="outline" className="text-[11px] font-normal">{PROVIDER_LABELS[channel.provider]}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {channel.eventTypeFilter.length === 0
                        ? "All event types"
                        : `${channel.eventTypeFilter.length} event type(s)`}
                      {channel.cooldownSeconds > 0 && ` · ${channel.cooldownSeconds}s cooldown`}
                    </p>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground sm:hidden">Enabled</span>
                      <Switch
                        checked={channel.enabled}
                        disabled={busyId === channel.id}
                        onCheckedChange={(v) => toggleEnabled(channel.id, v)}
                      />
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={busyId === channel.id} className="size-8">
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
