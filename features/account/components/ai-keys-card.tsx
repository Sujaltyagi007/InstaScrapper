"use client";

import useSWR from "swr";
import { useState } from "react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { CheckCircle2, KeyRound, Loader2, Plus, RotateCw, ShieldCheck, Trash2 } from "lucide-react";
import { apiFetch, FetchError } from "@/lib/fetcher";
import { friendlyError } from "@/lib/friendly-error";
import { AI_KEYS_KEY } from "@/lib/swr-keys";
import {
  KEY_PROVIDERS,
  PROVIDER_INFO,
  detectProvider,
  maskKey,
  normalizeKey,
  type KeyGuess,
  type KeyProvider,
} from "@/lib/ai/key-detect";
import type { UserKeySummary } from "@/lib/ai/keys";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState } from "@/components/common/error-state";
import { LoadingState } from "@/components/common/loading-state";

interface KeysResponse {
  keys: UserKeySummary[];
  serverKeys: KeyProvider[];
}

interface Pending {
  key: string;
  guess: KeyGuess;
  provider: KeyProvider | "";
  error: string | null;
  canForce: boolean;
}

function providerLabel(provider: string): string {
  return PROVIDER_INFO[provider as KeyProvider]?.label ?? provider;
}

function guessLine(guess: KeyGuess): string {
  if (!guess.provider) return "Couldn't tell which service this key is for. Pick it below.";
  const label = PROVIDER_INFO[guess.provider].label;
  return guess.confidence === "sure"
    ? `This looks like a ${label} key.`
    : `This might be a ${label} key (a guess from its length). Check it's right.`;
}

function KeyStatus({ k }: { k: UserKeySummary }) {
  if (k.status === "INVALID") return <Badge variant="destructive" className="px-1.5 py-0 text-[11px]">Not working</Badge>;
  if (k.exhaustedUntil) {
    return (
      <Badge variant="warning" className="px-1.5 py-0 text-[11px]">
        Out of quota until {format(new Date(k.exhaustedUntil), "MMM d, h:mm a")}
      </Badge>
    );
  }
  if (k.limitedScopes.length > 0) {
    const names = k.limitedScopes.map((s) => s.scope).join(", ");
    return (
      <Badge variant="warning" className="px-1.5 py-0 text-[11px]" title={`Out of quota for: ${names}`}>
        {k.limitedScopes.length} model{k.limitedScopes.length === 1 ? "" : "s"} resting
      </Badge>
    );
  }
  return <Badge variant="success" className="px-1.5 py-0 text-[11px]">Active</Badge>;
}


export function AIKeysCard({ className }: { className?: string }) {
  const { data, error, isLoading, mutate } = useSWR<KeysResponse>(AI_KEYS_KEY);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function review(raw: string) {
    const key = normalizeKey(raw);
    if (!key) return;
    const guess = detectProvider(key);
    setPending({ key, guess, provider: guess.provider ?? "", error: null, canForce: false });
  }

  async function save(force = false) {
    if (!pending?.provider) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ key: UserKeySummary; check: string }>(AI_KEYS_KEY, {
        method: "POST",
        body: JSON.stringify({ provider: pending.provider, key: pending.key, force }),
      });
      const label = providerLabel(pending.provider);
      if (res.check === "limited") toast.success(`${label} key saved. It's out of quota right now and will be used once it resets.`);
      else if (res.check === "unreachable") toast.success(`${label} key saved without a check.`);
      else toast.success(`${label} key checked and saved.`);
      setPending(null);
      setDraft("");
      mutate();
    } catch (err) {
      const canForce = err instanceof FetchError && err.code === "KEY_CHECK_FAILED";
      const own = err instanceof FetchError && ["KEY_INVALID", "KEY_DUPLICATE", "KEY_CHECK_FAILED", "KEY_MALFORMED"].includes(err.code ?? "");
      setPending((p) => p && { ...p, error: own ? (err as FetchError).message : friendlyError(err, "Couldn't save the key."), canForce });
    } finally {
      setSaving(false);
    }
  }

  async function recheck(k: UserKeySummary) {
    setBusyId(k.id);
    try {
      const res = await apiFetch<{ check: string }>(`${AI_KEYS_KEY}/${k.id}`, { method: "PATCH", body: JSON.stringify({ action: "recheck" }) });
      const label = providerLabel(k.provider);
      if (res.check === "ok") toast.success(`${label} key ${maskKey(k.last4)} works.`);
      else if (res.check === "limited") toast.message(`${label} key ${maskKey(k.last4)} is real but out of quota right now.`);
      else toast.error(`${label} rejected key ${maskKey(k.last4)}.`);
      mutate();
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't check the key."));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(k: UserKeySummary) {
    if (!confirm(`Remove the ${providerLabel(k.provider)} key ${maskKey(k.last4)}?`)) return;
    mutate((cur) => cur && { ...cur, keys: cur.keys.filter((x) => x.id !== k.id) }, { revalidate: false });
    try {
      await apiFetch(`${AI_KEYS_KEY}/${k.id}`, { method: "DELETE" });
      toast.success("Key removed.");
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't remove the key."));
    } finally {
      mutate();
    }
  }

  const groups = KEY_PROVIDERS.map((provider) => ({
    provider,
    keys: (data?.keys ?? []).filter((k) => k.provider === provider),
    server: data?.serverKeys.includes(provider) ?? false,
  })).filter((g) => g.keys.length > 0);

  return (
    <Card size="sm" className={className}>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription className="text-xs">
          Paste a key and the app works out which service it&apos;s for. Each key is tested before it&apos;s saved and stored
          encrypted. Add several for one service and they&apos;re used in turn: when one runs out, the next takes over.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex gap-2" onSubmit={(e) => {
          e.preventDefault(); review(draft);
        }} >
          <Input value={draft} onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (!text.trim()) return;
              e.preventDefault();
              setDraft(text.trim());
              review(text);
            }}
            placeholder="Paste an API key"
            aria-label="API key"
            autoComplete="off"
            spellCheck={false}
            className="h-8 font-mono text-xs"
          />
          <Button type="submit" size="sm" className="h-8 shrink-0" disabled={!draft.trim()}>
            <Plus className="size-3.5" /> Add
          </Button>
        </form>

        {isLoading && !data ? (
          <LoadingState rows={2} />
        ) : !data ? (
          <ErrorState title="Couldn't load your keys" message={friendlyError(error, "Please try again.")} onRetry={() => mutate()} />
        ) : groups.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
            No keys added yet.
            {data.serverKeys.length > 0 && ` The app uses the server's own keys for ${data.serverKeys.map(providerLabel).join(", ")}.`}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              <div key={g.provider} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <p className="text-sm font-medium">{PROVIDER_INFO[g.provider].label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {PROVIDER_INFO[g.provider].usedFor}
                    {g.keys.length > 1 && " · used top to bottom"}
                    {g.server && " · server key as backup"}
                  </p>
                </div>
                {g.keys.map((k) => (
                  <div key={k.id} className="flex items-center gap-2 rounded-lg border p-2">
                    <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs">{maskKey(k.last4)}</span>
                        <KeyStatus k={k} />
                      </div>
                      <span className="truncate text-[11px] text-muted-foreground" title={k.lastError ?? undefined}>
                        {k.status === "INVALID" && k.lastError
                          ? k.lastError
                          : k.lastUsedAt
                            ? `Last used ${formatDistanceToNow(new Date(k.lastUsedAt), { addSuffix: true })}`
                            : `Added ${formatDistanceToNow(new Date(k.createdAt), { addSuffix: true })}`}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      title="Check again"
                      aria-label={`Check ${maskKey(k.last4)} again`}
                      disabled={busyId === k.id}
                      onClick={() => recheck(k)}
                    >
                      {busyId === k.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:bg-destructive/10"
                      title="Remove"
                      aria-label={`Remove ${maskKey(k.last4)}`}
                      onClick={() => remove(k)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && !saving && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add this key?</DialogTitle>
            <DialogDescription>{pending ? guessLine(pending.guess) : null}</DialogDescription>
          </DialogHeader>
          {pending && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2.5">
                <KeyRound className="size-4 text-muted-foreground" />
                <span className="font-mono text-xs">{maskKey(pending.key.slice(-4))}</span>
                {pending.guess.confidence === "sure" && pending.provider === pending.guess.provider && (
                  <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CheckCircle2 className="size-3.5 text-emerald-500" /> Detected
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="key-provider" className="text-xs">Service</Label>
                <Select
                  value={pending.provider}
                  onValueChange={(v) => setPending((p) => p && { ...p, provider: v as KeyProvider, error: null, canForce: false })}
                >
                  <SelectTrigger id="key-provider" className="h-9">
                    <SelectValue placeholder="Pick the service" />
                  </SelectTrigger>
                  <SelectContent>
                    {KEY_PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PROVIDER_INFO[p].label}
                        <span className="ml-1 text-muted-foreground">· {PROVIDER_INFO[p].usedFor}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {pending.provider && !PROVIDER_INFO[pending.provider].inUse && (
                <p className="text-xs text-muted-foreground">The app doesn&apos;t use {PROVIDER_INFO[pending.provider].label} yet; the key is kept for later.</p>
              )}
              {pending.error && (
                <p role="alert" className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  {pending.error}
                </p>
              )}
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="size-3.5" /> Tested with the service first, then stored encrypted. Only the last 4 characters are shown again.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setPending(null)} disabled={saving}>
              Cancel
            </Button>
            {pending?.canForce && (
              <Button variant="outline" onClick={() => save(true)} disabled={saving}>
                Save anyway
              </Button>
            )}
            <Button onClick={() => save(false)} disabled={saving || !pending?.provider}>
              {saving && <Loader2 className="size-3.5 animate-spin" />} Check &amp; save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
