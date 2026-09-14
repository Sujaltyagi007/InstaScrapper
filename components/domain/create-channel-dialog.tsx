"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/fetcher";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateChannelDialog({ open, onOpenChange, onCreated }: CreateChannelDialogProps) {
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<"DISCORD" | "NTFY" | "WEBHOOK">("DISCORD");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [ntfyServer, setNtfyServer] = useState("https://ntfy.sh");
  const [ntfyTopic, setNtfyTopic] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    let config: Record<string, unknown> = { provider };
    if (provider === "DISCORD") {
      config = { provider, webhookUrl };
    } else if (provider === "NTFY") {
      config = { provider, serverUrl: ntfyServer, topic: ntfyTopic };
    } else if (provider === "WEBHOOK") {
      config = { provider, url: webhookUrl };
    }

    try {
      await apiFetch("/api/notification-channels", {
        method: "POST",
        body: JSON.stringify({
          name,
          config,
        }),
      });
      toast.success("Notification channel created.");
      setName("");
      setWebhookUrl("");
      setNtfyTopic("");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create channel.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Notification Channel</DialogTitle>
            <DialogDescription>
              Configure an alert destination to get notified about changes.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Channel Name</Label>
              <Input
                id="name"
                placeholder="e.g. My Discord Alerts"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider">Provider</Label>
              <select
                id="provider"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={provider}
                onChange={(e) => setProvider(e.target.value as "DISCORD" | "NTFY" | "WEBHOOK")}
              >
                <option value="DISCORD">Discord</option>
                <option value="NTFY">ntfy</option>
                <option value="WEBHOOK">Generic Webhook</option>
              </select>
            </div>

            {provider === "DISCORD" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="discordUrl">Discord Webhook URL</Label>
                <Input
                  id="discordUrl"
                  placeholder="https://discord.com/api/webhooks/..."
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  required
                />
              </div>
            )}

            {provider === "NTFY" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ntfyServer">ntfy Server URL</Label>
                  <Input
                    id="ntfyServer"
                    value={ntfyServer}
                    onChange={(e) => setNtfyServer(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ntfyTopic">Topic</Label>
                  <Input
                    id="ntfyTopic"
                    placeholder="my-alerts-topic"
                    value={ntfyTopic}
                    onChange={(e) => setNtfyTopic(e.target.value)}
                    required
                  />
                </div>
              </>
            )}

            {provider === "WEBHOOK" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="webhookUrl">Webhook URL</Label>
                <Input
                  id="webhookUrl"
                  placeholder="https://example.com/webhook"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  required
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="animate-spin mr-2" />}
              Create channel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
