"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Search, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { apiFetch, FetchError } from "@/lib/fetcher";
import { toast } from "sonner";
import type { TargetResolution } from "@/lib/meta/types";

const RESULT_ICON: Record<string, React.ReactNode> = {
  AVAILABLE: <CheckCircle2 className="size-4 text-success" />,
  UNAVAILABLE: <XCircle className="size-4 text-destructive" />,
  NOT_AUTHORIZED: <XCircle className="size-4 text-destructive" />,
  NOT_SUPPORTED_FOR_TARGET: <AlertCircle className="size-4 text-muted-foreground" />,
  RATE_LIMITED: <AlertCircle className="size-4 text-warning-foreground" />,
  TEMPORARY_FAILURE: <AlertCircle className="size-4 text-warning-foreground" />,
};

export default function NewTargetPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<TargetResolution | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [watchNewMedia, setWatchNewMedia] = useState(true);
  const [watchProfile, setWatchProfile] = useState(true);
  const [watchFollowerCount, setWatchFollowerCount] = useState(false);
  const [watchStories, setWatchStories] = useState(true);
  const [watchReels, setWatchReels] = useState(true);
  const [watchFollowerChurn, setWatchFollowerChurn] = useState(false);
  const [watchCollabPosts, setWatchCollabPosts] = useState(true);
  const [jitterEnabled, setJitterEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(90);
  const [creating, setCreating] = useState(false);

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
      const data = await apiFetch<{ target: { id: string } }>("/api/targets", {
        method: "POST",
        body: JSON.stringify({
          username: resolution.username,
          watchNewMedia,
          watchProfile,
          watchFollowerCount,
          watchStories,
          watchReels,
          watchFollowerChurn,
          watchCollabPosts,
          jitterEnabled,
          intervalSeconds: intervalMinutes * 60,
          notificationChannelIds: [],
        }),
      });
      toast.success(`Now monitoring @${resolution.username}.`);
      router.push(`/targets/${data.target.id}`);
    } catch (err) {
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

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={onResolve} className="flex gap-2">
            <Input
              placeholder="username (without @)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <Button type="submit" disabled={resolving}>
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
            <ToggleRow
              label="New posts & reels"
              description="Notify when a new post or reel appears."
              checked={watchNewMedia}
              onCheckedChange={setWatchNewMedia}
            />
            <ToggleRow
              label="Stories"
              description="Capture expiring stories, videos, and captions."
              checked={watchStories}
              onCheckedChange={setWatchStories}
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
              label="Follower churn detection"
              description="Detect who followed or unfollowed even if total count stays the same."
              checked={watchFollowerChurn}
              onCheckedChange={setWatchFollowerChurn}
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
            <Button onClick={onCreate} disabled={creating} className="w-full">
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
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
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
