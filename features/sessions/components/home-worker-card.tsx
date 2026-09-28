"use client";
import { toast } from "sonner";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Copy, Laptop, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/friendly-error";
import { useHomeWorkerDevices } from "@/features/sessions/hooks/use-home-worker";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

function copy(text: string, label: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied.`),
    () => toast.error(`Couldn't copy ${label.toLowerCase()}.`),
  );
}

/** Online = seen in the last 45s — a bit over the worker's own ~25s poll cycle. */
function isOnline(lastSeenAt: string | null): boolean {
  return Boolean(lastSeenAt) && Date.now() - new Date(lastSeenAt!).getTime() < 45_000;
}

export function HomeWorkerCard() {
  const { devices, loading, error, refresh, pair, revoke } = useHomeWorkerDevices();
  const [pairOpen, setPairOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [pairing, setPairing] = useState(false);
  const [issued, setIssued] = useState<{ appUrl: string; token: string } | null>(null);

  async function handlePair() {
    setPairing(true);
    try {
      const res = await pair(label.trim() || "Home worker");
      setIssued({ appUrl: window.location.origin, token: res.token });
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't pair that device."));
    } finally {
      setPairing(false);
    }
  }

  function closePairDialog() {
    setPairOpen(false);
    setLabel("");
    setIssued(null);
  }

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <CardTitle>Home worker</CardTitle>
            <CardDescription className="text-xs">
              Run one paired burner&apos;s requests from your own PC and home IP instead of the
              Webshare proxy. One device per burner — never your real account.
            </CardDescription>
          </div>
          <Button size="sm" className="w-fit" onClick={() => setPairOpen(true)}>
            <Plus className="size-3.5 mr-1" /> Pair device
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading && !devices ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : error && !devices ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : !devices || devices.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No devices paired yet. Pair one, then set a session&apos;s transport to &quot;Home
            worker&quot; below.
          </p>
        ) : (
          devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2 min-w-0">
                <Laptop className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">{d.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {d.status === "REVOKED"
                      ? "Revoked"
                      : d.lastSeenAt
                        ? `Last seen ${formatDistanceToNow(new Date(d.lastSeenAt), { addSuffix: true })}`
                        : "Never connected"}
                  </span>
                </div>
                {d.status === "ACTIVE" && (
                  <Badge variant={isOnline(d.lastSeenAt) ? "success" : "outline"} className="text-[11px] px-1.5 py-0 shrink-0">
                    {isOnline(d.lastSeenAt) ? "Online" : "Offline"}
                  </Badge>
                )}
              </div>
              {d.status === "ACTIVE" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 text-destructive hover:bg-destructive/10 shrink-0"
                  onClick={() =>
                    revoke(d.id).catch((err) => toast.error(friendlyError(err, "Couldn't revoke that device.")))
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={pairOpen} onOpenChange={(o) => (o ? setPairOpen(true) : closePairDialog())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pair a device</DialogTitle>
            <DialogDescription>
              This device runs <code>worker/home-worker.mjs</code> on the PC whose IP the burner
              should use. Set up steps: <code>docs/home-worker-setup.md</code>.
            </DialogDescription>
          </DialogHeader>

          {!issued ? (
            <>
              <div className="flex flex-col gap-1.5 py-2">
                <Label htmlFor="hw-label">Label</Label>
                <Input
                  id="hw-label"
                  placeholder="My desktop"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  disabled={pairing}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closePairDialog} disabled={pairing}>
                  Cancel
                </Button>
                <Button type="button" onClick={handlePair} disabled={pairing}>
                  {pairing && <Loader2 className="animate-spin mr-2" />}
                  Pair
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-3 py-2 text-sm">
                <p className="text-xs text-muted-foreground">
                  This token is shown once. On the target PC, set these two values (e.g. in a{" "}
                  <code>.env</code> file next to <code>home-worker.mjs</code>), then run{" "}
                  <code>node home-worker.mjs</code>.
                </p>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">APP_URL</Label>
                  <div className="flex gap-1.5">
                    <Input readOnly value={issued.appUrl} className="font-mono text-xs" />
                    <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => copy(issued.appUrl, "APP_URL")}>
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">DEVICE_TOKEN</Label>
                  <div className="flex gap-1.5">
                    <Input readOnly value={issued.token} className="font-mono text-xs" />
                    <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => copy(issued.token, "DEVICE_TOKEN")}>
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  onClick={() => {
                    closePairDialog();
                    refresh();
                  }}
                >
                  Done
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
