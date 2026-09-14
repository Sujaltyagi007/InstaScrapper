"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/fetcher";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface AddSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function AddSessionDialog({ open, onOpenChange, onCreated }: AddSessionDialogProps) {
  const [rawCookies, setRawCookies] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rawCookies.trim()) {
      toast.error("Please enter cookies.");
      return;
    }

    setLoading(true);
    try {
      await apiFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          authMethod: "COOKIE_INPUT",
          rawCookies,
          proxyUrl: proxyUrl.trim() || undefined,
        }),
      });
      toast.success("Instagram session connected.");
      setRawCookies("");
      setProxyUrl("");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect session.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Connect Instagram Session</DialogTitle>
            <DialogDescription>
              Paste cookies from your browser session (e.g. sessionid=...; ds_user_id=...) to monitor private data, stories, or bypass rate limits.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cookies">Session Cookies (raw or JSON)</Label>
              <Input
                id="cookies"
                placeholder="sessionid=...; ds_user_id=..."
                value={rawCookies}
                onChange={(e) => setRawCookies(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="proxy">Proxy URL (Optional)</Label>
              <Input
                id="proxy"
                placeholder="http://user:pass@host:port"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="animate-spin mr-2" />}
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
