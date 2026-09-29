"use client";
import Link from "next/link";
import { toast } from "sonner";
import { useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import type { NicheData } from "../hooks/use-niche";
import { friendlyError } from "@/lib/friendly-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Suggestion {
  username: string;
  reason: string;
}

export function NicheAccountsCard({ data, onChanged }: { data: NicheData; onChanged: () => void }) {
  const accounts = data.niche?.accounts ?? [];
  const [username, setUsername] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  async function add(handle: string, source: "USER" | "SUGGESTED") {
    setAdding(handle);
    try {
      await apiFetch("/api/niche/accounts", { method: "POST", body: JSON.stringify({ username: handle, source }) });
      toast.success(`@${handle} added.`);
      setSuggestions((list) => list.filter((s) => s.username !== handle));
      if (source === "USER") setUsername("");
      onChanged();
    } catch (err) {
      toast.error(friendlyError(err, "Failed to add account."));
    } finally {
      setAdding(null);
    }
  }

  async function remove(id: string, handle: string) {
    try {
      await apiFetch(`/api/niche/accounts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      toast.success(`@${handle} removed.`);
      onChanged();
    } catch (err) {
      toast.error(friendlyError(err, "Failed to remove account."));
    }
  }

  async function suggest() {
    setSuggesting(true);
    try {
      const res = await apiFetch<{ suggestions: Suggestion[] }>("/api/niche/suggestions", { method: "POST" });
      setSuggestions(res.suggestions);
      if (res.suggestions.length === 0) toast.info("No new suggestions. Try adding more detail to your niche.");
    } catch (err) {
      toast.error(friendlyError(err, "Failed to get suggestions."));
    } finally {
      setSuggesting(false);
    }
  }

  const handle = username.trim().replace(/^@/, "");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Accounts to learn from</CardTitle>
        <CardDescription>
          Popular accounts in your niche. The app checks their reels twice a day to see what&apos;s trending. Nothing
          of theirs is ever posted. Each account counts toward your account limit.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!data.hasActiveSession && (
          <Alert>
            <AlertTriangle />
            <AlertDescription>
              Automatic metrics need an active Instagram session. You can still enter views, likes, comments and dates
              manually in the post metrics card below. {" "}
              <Link href="/settings" className="underline">
                Add a session for automatic collection
              </Link>
              .
            </AlertDescription>
          </Alert>
        )}

        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounts yet. Add a few you know, or ask for suggestions.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-medium">
                    @{a.target.username}
                    {a.target.status !== "ACTIVE" && <Badge variant="outline">{a.target.status}</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {a.target._count.media} posts collected ·{" "}
                    {a.target.lastSuccessAt
                      ? `checked ${formatDistanceToNow(new Date(a.target.lastSuccessAt), { addSuffix: true })}`
                      : "first check pending"}
                  </span>
                  {a.target.errorMessage && a.target.status !== "ACTIVE" && (
                    <span className="text-xs text-destructive">{a.target.errorMessage}</span>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => remove(a.id, a.target.username)}>
                  <Trash2 /> Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (handle) add(handle, "USER");
          }}
        >
          <Input placeholder="@username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <Button type="submit" disabled={!handle || adding !== null}>
            {adding === handle && handle ? <Loader2 className="animate-spin" /> : <Plus />} Add
          </Button>
        </form>
        {adding && (
          <p className="text-xs text-muted-foreground">Checking @{adding} on Instagram… this can take up to 30 seconds.</p>
        )}

        <div className="flex flex-col gap-3">
          <Button variant="outline" className="w-fit" onClick={suggest} disabled={suggesting || !data.niche}>
            {suggesting ? <Loader2 className="animate-spin" /> : <Sparkles />} Suggest accounts
          </Button>
          {suggestions.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                AI suggestions. Each one is checked on Instagram when you add it, so ones that don&apos;t exist are rejected.
              </p>
              <ul className="flex flex-col divide-y rounded-lg border">
                {suggestions.map((s) => (
                  <li key={s.username} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">@{s.username}</span>
                      <span className="text-xs text-muted-foreground">{s.reason}</span>
                    </div>
                    <Button size="sm" variant="outline" disabled={adding !== null} onClick={() => add(s.username, "SUGGESTED")}>
                      {adding === s.username ? <Loader2 className="animate-spin" /> : <Plus />} Add
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
