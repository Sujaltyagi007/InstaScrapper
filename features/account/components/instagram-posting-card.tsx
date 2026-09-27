"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, Link2, PauseCircle, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface IgAccountRow {
  id: string;
  username: string | null;
  igUserId: string;
  accountType: string | null;
  status: string;
  tokenExpiresAt: string | null;
  postingPaused: boolean;
  pausedReason: string | null;
}

interface IgAccountsResponse {
  configured: boolean;
  accounts: IgAccountRow[];
}

export function InstagramPostingCard() {
  const [data, setData] = useState<IgAccountsResponse | null>(null);

  const refresh = useCallback(() => {
    apiFetch<IgAccountsResponse>("/api/ig/accounts").then(setData).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The OAuth callback lands back here with the outcome in the query string;
  // strip it so a page refresh doesn't replay the toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("ig_connected");
    const error = params.get("ig_error");
    if (!connected && !error) return;
    if (connected) toast.success(connected === "1" ? "Instagram connected for posting." : `Connected @${connected} for posting.`);
    if (error) toast.error(error);
    params.delete("ig_connected");
    params.delete("ig_error");
    const rest = params.toString();
    window.history.replaceState({}, "", rest ? `${window.location.pathname}?${rest}` : window.location.pathname);
    refresh();
  }, [refresh]);

  async function disconnect(id: string) {
    try {
      await apiFetch(`/api/ig/accounts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      toast.success("Instagram posting account disconnected.");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect.");
    }
  }

  const accounts = data?.accounts ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Instagram posting account</CardTitle>
        <CardDescription>
          Connect the Instagram account your reels are posted to, through Instagram&apos;s official API. No
          Facebook Page needed. The account must be a Creator or Business account.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data && !data.configured && (
          <Alert>
            <AlertTriangle />
            <AlertDescription>
              The server has no Instagram app configured. Set <code>INSTAGRAM_APP_ID</code> and{" "}
              <code>INSTAGRAM_APP_SECRET</code> (from your Meta app&apos;s Instagram API setup) before connecting.
            </AlertDescription>
          </Alert>
        )}

        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No posting account connected yet.</p>
        ) : (
          accounts.map((account) => (
            <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex flex-col gap-1 text-sm">
                <span className="flex items-center gap-2">
                  {account.status !== "ACTIVE" ? (
                    <AlertTriangle className="size-4 text-destructive" />
                  ) : account.postingPaused ? (
                    <PauseCircle className="size-4 text-amber-500" />
                  ) : (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  )}
                  {account.username ? `@${account.username}` : account.igUserId}
                  <Badge variant="outline">{account.postingPaused ? "PAUSED" : account.status}</Badge>
                </span>
                {account.postingPaused && account.pausedReason && (
                  <span className="text-xs text-destructive">Posting paused: {account.pausedReason}</span>
                )}
                {account.status !== "ACTIVE" && (
                  <span className="text-xs text-destructive">Reconnect to resume posting.</span>
                )}
                {account.tokenExpiresAt && account.status === "ACTIVE" && (
                  <span className="text-xs text-muted-foreground">
                    Token renews automatically · expires{" "}
                    {formatDistanceToNow(new Date(account.tokenExpiresAt), { addSuffix: true })}
                  </span>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => disconnect(account.id)}>
                <Trash2 /> Disconnect
              </Button>
            </div>
          ))
        )}

        <Button asChild variant="outline" className="w-fit" disabled={!data?.configured}>
          <a href="/api/ig/connect">
            <Link2 /> {accounts.length > 0 ? "Reconnect" : "Connect Instagram"}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
