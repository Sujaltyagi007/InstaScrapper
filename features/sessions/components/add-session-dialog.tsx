"use client";
import { friendlyError } from "@/lib/friendly-error";
import { toast } from "sonner";
import { useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { apiFetch, FetchError } from "@/lib/fetcher";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

interface AddSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

type Mode = "login" | "paste";

interface TwoFactorCtx {
  identifier: string;
  csrftoken: string;
  mid: string;
}

export function AddSessionDialog({ open, onOpenChange, onCreated }: AddSessionDialogProps) {
  const [mode, setMode] = useState<Mode>("login");

  // Shared
  const [proxyUrl, setProxyUrl] = useState("");
  const [loading, setLoading] = useState(false);

  // Login mode
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactor, setTwoFactor] = useState<TwoFactorCtx | null>(null);
  const [code, setCode] = useState("");
  const [checkpoint, setCheckpoint] = useState<string | null>(null);

  // Paste mode
  const [rawCookies, setRawCookies] = useState("");

  function reset() {
    setUsername("");
    setPassword("");
    setProxyUrl("");
    setRawCookies("");
    setTwoFactor(null);
    setCode("");
    setCheckpoint(null);
  }

  function close() {
    reset();
    onOpenChange(false);
  }

  async function submitPaste(e: React.FormEvent) {
    e.preventDefault();
    if (!rawCookies.trim()) return toast.error("Please enter cookies.");
    setLoading(true);
    try {
      await apiFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ authMethod: "COOKIE_INPUT", rawCookies, proxyUrl: proxyUrl.trim() || undefined }),
      });
      toast.success("Instagram session connected.");
      close();
      onCreated();
    } catch (err) {
      toast.error(friendlyError(err, "Failed to connect session."));
    } finally {
      setLoading(false);
    }
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setCheckpoint(null);
    setLoading(true);
    try {
      const body = twoFactor
        ? { username, password, proxyUrl: proxyUrl.trim() || undefined, twoFactor: { ...twoFactor, code } }
        : { username, password, proxyUrl: proxyUrl.trim() || undefined };

      const res = await apiFetch<{
        status: string;
        twoFactor?: { identifier: string; csrftoken: string; mid: string };
      }>("/api/sessions/login", { method: "POST", body: JSON.stringify(body) });

      if (res.status === "two_factor_required" && res.twoFactor) {
        setTwoFactor(res.twoFactor);
        toast.message("Enter the code from your authenticator app or SMS.");
        return;
      }
      toast.success("Logged in — Instagram session connected.");
      close();
      onCreated();
    } catch (err) {
      // Checkpoint → steer to the paste tab (a browser login clears it).
      if (err instanceof FetchError && err.code === "IG_CHECKPOINT") {
        setCheckpoint(err.message);
      } else {
        toast.error(friendlyError(err, "Login failed."));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Instagram Session</DialogTitle>
          <DialogDescription>
            Use a <strong>burner</strong> account, never your main one — automated login is the
            highest-risk action for an account.
          </DialogDescription>
        </DialogHeader>

        {/* Mode switch */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`rounded-md py-1.5 font-medium transition ${mode === "login" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => setMode("paste")}
            className={`rounded-md py-1.5 font-medium transition ${mode === "paste" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            Paste cookies
          </button>
        </div>

        {mode === "login" ? (
          <form onSubmit={submitLogin}>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ig-user">Username</Label>
                <Input id="ig-user" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} disabled={loading || Boolean(twoFactor)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ig-pass">Password</Label>
                <Input id="ig-pass" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading || Boolean(twoFactor)} required />
                <p className="text-xs text-muted-foreground">Used once to log in, then discarded — only the resulting session cookie is stored (encrypted).</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ig-proxy">Fixed proxy (leave empty to get one automatically; never a rotating proxy)</Label>
                <Input id="ig-proxy" placeholder="http://user:pass@host:port" value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} disabled={loading || Boolean(twoFactor)} />
              </div>

              {twoFactor && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ig-2fa">Two-factor code</Label>
                  <Input id="ig-2fa" inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} disabled={loading} required />
                  <p className="text-xs text-muted-foreground">From your authenticator app or SMS.</p>
                </div>
              )}

              {checkpoint && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  <ShieldAlert className="mt-px size-4 shrink-0" />
                  <span>{checkpoint} You can switch to “Paste cookies” above once you’ve logged in through a browser.</span>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={loading}>Cancel</Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="animate-spin mr-2" />}
                {twoFactor ? "Verify code" : "Log in"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={submitPaste}>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cookies">Session cookies (raw or JSON)</Label>
                <Input id="cookies" placeholder="sessionid=...; ds_user_id=..." value={rawCookies} onChange={(e) => setRawCookies(e.target.value)} required />
                <p className="text-xs text-muted-foreground">From a logged-in browser: DevTools → Application → Cookies → copy sessionid and ds_user_id.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="proxy2">Fixed proxy (leave empty to get one automatically; use the same IP the cookies came from)</Label>
                <Input id="proxy2" placeholder="http://user:pass@host:port" value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={loading}>Cancel</Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="animate-spin mr-2" />}
                Connect
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
