"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Search, CheckCircle2, XCircle, AlertCircle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch, FetchError } from "@/lib/fetcher";
import { toast } from "sonner";
import type { TargetResolution } from "@/lib/meta/types";
import { useSessions } from "@/features/sessions/hooks/use-sessions";
import { useTargetQuota } from "@/features/account/hooks/use-target-quota";
import { TargetQuotaBanner } from "@/features/account/components/target-quota-banner";

const RESULT_ICON: Record<string, React.ReactNode> = {
  AVAILABLE: <CheckCircle2 className="size-4 text-success" />,
  UNAVAILABLE: <XCircle className="size-4 text-destructive" />,
  NOT_AUTHORIZED: <XCircle className="size-4 text-destructive" />,
  NOT_SUPPORTED_FOR_TARGET: <AlertCircle className="size-4 text-muted-foreground" />,
  RATE_LIMITED: <AlertCircle className="size-4 text-warning-foreground" />,
  TEMPORARY_FAILURE: <AlertCircle className="size-4 text-warning-foreground" />,
};

/** Stable code from quota.service; matched on code, never on message text. */
const TARGET_LIMIT_REACHED = "TARGET_LIMIT_REACHED";

export default function NewTargetPage() {
  const router = useRouter();
  const { quota, refresh: refreshQuota } = useTargetQuota();
  const atLimit = quota?.level === "FULL";
  const { sessions } = useSessions();
  const [username, setUsername] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<TargetResolution | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [instagramSessionId, setInstagramSessionId] = useState<string | null>(null);
  const [watchNewMedia, setWatchNewMedia] = useState(true);
  const [watchProfile, setWatchProfile] = useState(true);
  const [watchFollowerCount, setWatchFollowerCount] = useState(false);
  const [watchFollowingCount, setWatchFollowingCount] = useState(false);
  const [watchStories, setWatchStories] = useState(true);
  const [watchReels, setWatchReels] = useState(true);
  const [watchFollowerChurn, setWatchFollowerChurn] = useState(false);
  const [watchCollabPosts, setWatchCollabPosts] = useState(true);
  const [jitterEnabled, setJitterEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(90);
  const [creating, setCreating] = useState(false);

  const activeSessions = (sessions ?? []).filter((s) => s.status === "ACTIVE");
  const locked = !instagramSessionId;

  async function onResolve(e: React.FormEvent) {
    e.preventDefault();
    setResolveError(null);
    setResolution(null);
    setResolving(true);
    try {
      const data = await apiFetch<{ resolution: TargetResolution; message: string }>("/api/targets/resolve", {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      setResolution(data.resolution);
      setMessage(data.message);
    } catch (err) {
      if (err instanceof FetchError && err.status === 409) {
        setResolveError("You're already monitoring this account.");
      } else if (err instanceof FetchError && err.code === TARGET_LIMIT_REACHED) {
        setResolveError(err.message);
        refreshQuota();
      } else {
        setResolveError(err instanceof Error ? err.message : "Failed to resolve this account.");
      }
    } finally {
      setResolving(false);
    }
  }

  const monitorable = resolution && (resolution.eligibility === "SUPPORTED" || resolution.eligibility === "PARTIALLY_SUPPORTED");

  async function onCreate() {
    if (!resolution) return;
    setCreating(true);
    try {
      // Defensive: never send an advanced/session-gated toggle as true
      // without a session actually selected.
      const hasSession = Boolean(instagramSessionId);
      const data = await apiFetch<{ target: { id: string } }>("/api/targets", {
        method: "POST",
        body: JSON.stringify({
          username: resolution.username,
          instagramSessionId,
          watchNewMedia,
          watchProfile,
          watchFollowerCount,
          watchFollowingCount: hasSession && watchFollowingCount,
          watchStories: hasSession && watchStories,
          watchReels,
          watchFollowerChurn: hasSession && watchFollowerChurn,
          watchCollabPosts,
          jitterEnabled,
          intervalSeconds: intervalMinutes * 60,
          notificationChannelIds: [],
        }),
      });
      toast.success(`Now monitoring @${resolution.username}.`);
      router.push(`/targets/${data.target.id}`);
    } catch (err) {
      if (err instanceof FetchError && err.code === TARGET_LIMIT_REACHED) {
        // Someone may have hit the limit from another tab since this page
        // loaded — refresh so the banner and disabled state catch up.
        refreshQuota();
        toast.error(err.message, {
          action: err.details?.canRaise
            ? { label: "Raise limit", onClick: () => router.push("/settings#account-limit") }
            : undefined,
        });
        return;
      }
      toast.error(err instanceof Error ? err.message : "Failed to create target.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href="/targets">
            <ArrowLeft /> Back to targets
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Add a target</h1>
        <p className="text-sm text-muted-foreground">Enter an Instagram username to start monitoring it.</p>
      </div>

      <TargetQuotaBanner quota={quota} />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={onResolve} className="flex gap-2">
            <Input
              placeholder="username (without @)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <Button type="submit" disabled={resolving || atLimit}>
              {resolving ? <Loader2 className="animate-spin" /> : <Search />}
              Resolve
            </Button>
          </form>
          {resolveError && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{resolveError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {resolution && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              @{resolution.username}
              <Badge variant="outline">{resolution.accountType}</Badge>
            </CardTitle>
            <CardDescription>{message}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {resolution.capabilities.map((cap) => (
              <div key={cap.capability} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{formatCapability(cap.capability)}</span>
                <span className="flex items-center gap-1.5">
                  {RESULT_ICON[cap.result]}
                  {formatResult(cap.result)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {monitorable && (
        <Card>
          <CardHeader>
            <CardTitle>Monitoring settings</CardTitle>
            <CardDescription>Choose what to watch and configure anti-bot detection avoidance.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Instagram session (optional)</Label>
              <Select
                value={instagramSessionId ?? "none"}
                onValueChange={(v) => setInstagramSessionId(v === "none" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None (anonymous)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (anonymous)</SelectItem>
                  {activeSessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      @{s.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Pin this target to a burner session to unlock Stories, follower/following churn, and following count below.
              </p>
            </div>

            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2">
              Basic (no login required)
            </p>
            <ToggleRow
              label="New posts & reels"
              description="Notify when a new post or reel appears."
              checked={watchNewMedia}
              onCheckedChange={setWatchNewMedia}
            />
            <ToggleRow
              label="Reels count"
              description="Track total reels count changes over time."
              checked={watchReels}
              onCheckedChange={setWatchReels}
            />
            <ToggleRow
              label="Profile changes"
              description="Notify when name, bio, website, or photo changes."
              checked={watchProfile}
              onCheckedChange={setWatchProfile}
            />
            <ToggleRow
              label="Follower count"
              description="Notify when follower count changes."
              checked={watchFollowerCount}
              onCheckedChange={setWatchFollowerCount}
            />
            <ToggleRow
              label="Private collab posts probe"
              description="Detect leaked posts co-authored with public accounts."
              checked={watchCollabPosts}
              onCheckedChange={setWatchCollabPosts}
            />
            <ToggleRow
              label="Anti-bot request jitter"
              description="Apply randomized human sleep intervals between requests."
              checked={jitterEnabled}
              onCheckedChange={setJitterEnabled}
            />

            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2">
              Advanced (requires an Instagram session)
            </p>
            {locked && (
              <p className="text-xs text-muted-foreground -mt-2">
                Add an Instagram session in{" "}
                <Link href="/settings" className="underline">
                  Settings
                </Link>{" "}
                to unlock these.
              </p>
            )}
            <ToggleRow
              label="Stories"
              description="Capture expiring stories, videos, and captions."
              checked={watchStories}
              onCheckedChange={setWatchStories}
              locked={locked}
            />
            <ToggleRow
              label="Follower & following changes"
              description="Detect who followed/unfollowed or who they followed/unfollowed, even if totals stay the same."
              checked={watchFollowerChurn}
              onCheckedChange={setWatchFollowerChurn}
              locked={locked}
            />
            <ToggleRow
              label="Following count"
              description="Notify when following count changes."
              checked={watchFollowingCount}
              onCheckedChange={setWatchFollowingCount}
              locked={locked}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="interval">Check frequency</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="interval"
                  type="number"
                  min={5}
                  className="w-24"
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                />
                <span className="text-sm text-muted-foreground">minutes (recommended: 90 min to prevent rate limits)</span>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={onCreate} disabled={creating || atLimit} className="w-full">
              {creating && <Loader2 className="animate-spin" />}
              Start monitoring
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  locked,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  locked?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {label}
          {locked && <Lock className="size-3 text-muted-foreground" />}
        </p>
        <p className="text-xs text-muted-foreground">
          {locked ? "Requires an Instagram session." : description}
        </p>
      </div>
      <Switch checked={locked ? false : checked} disabled={locked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function formatCapability(capability: string): string {
  return capability
    .replace(/^TARGET_/, "")
    .split("_")
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(" ");
}

function formatResult(result: string): string {
  return result
    .split("_")
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(" ");
}
