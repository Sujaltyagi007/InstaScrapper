"use client";
import { friendlyError } from "@/lib/friendly-error";
import { toast } from "sonner";
import { apiFetch } from "@/lib/fetcher";
import { useEffect, useState } from "react";
import { navigate, takeFlash } from "@/features/shell/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SetupChecklist } from "@/features/account/components/setup-checklist";
import type { SettingsTab } from "@/features/account/lib/settings-tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { useJobs } from "@/features/monitoring/hooks/use-jobs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LoadingState } from "@/components/common/loading-state";
import { ErrorState } from "@/components/common/error-state";
import { useSessions } from "@/features/sessions/hooks/use-sessions";
import { HomeWorkerCard } from "@/features/sessions/components/home-worker-card";
import { useHomeWorkerDevices } from "@/features/sessions/hooks/use-home-worker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useSettings, type UserSettings } from "@/hooks/use-settings";
import { TargetLimitCard } from "@/features/account/components/target-limit-card";
import { AppearanceCard } from "@/features/account/components/appearance-card";
import { AIKeysCard } from "@/features/account/components/ai-keys-card";
import { useMetaStatus } from "@/features/account/hooks/use-meta-status";
import { AddSessionDialog } from "@/features/sessions/components/add-session-dialog";
import { CheckScheduleCard } from "@/features/account/components/check-schedule-card";
import { InstagramPostingCard } from "@/features/account/components/instagram-posting-card";
import { Loader2, Link2, CheckCircle2, AlertTriangle, Plus, Activity, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";

const JOB_STATUS_VARIANT: Record<string, "secondary" | "success" | "destructive" | "outline"> = {
  QUEUED: "secondary",
  RUNNING: "outline",
  SUCCEEDED: "success",
  FAILED: "destructive",
};

export function SettingsView({ section, anchor }: { section?: SettingsTab; anchor?: string }) {
  const { settings, error: settingsError, refresh } = useSettings();
  // The sub-tab is part of the app's screen, so Back, refresh and links all agree on it.
  const tab = section ?? "general";

  function changeTab(next: SettingsTab) {
    navigate({ tab: "settings", section: next }, { replace: true });
  }

  // "Raise limit" and similar links point at one card: bring it into view. The card
  // may only appear once its data has loaded, and cards above it (the setup checklist)
  // can appear after that and push it down, so align again while the page settles,
  // unless the user has started scrolling themselves.
  useEffect(() => {
    if (!anchor) return;
    let frame = 0;
    let tries = 0;
    const timers: number[] = [];
    const align = () => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const stop = () => timers.forEach(clearTimeout);
    const look = () => {
      const el = document.getElementById(anchor);
      if (el?.offsetParent) {
        align();
        timers.push(window.setTimeout(align, 600), window.setTimeout(align, 1500));
      } else if (++tries < 180) frame = requestAnimationFrame(look);
    };
    look();
    window.addEventListener("wheel", stop, { once: true, passive: true });
    window.addEventListener("touchstart", stop, { once: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      stop();
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
    };
  }, [anchor, tab]);

  const { jobs, loading: jobsLoading, error: jobsError, refresh: refreshJobs } = useJobs();
  const {
    sessions,
    poolHealth,
    loading: sessionsLoading,
    error: sessionsError,
    refresh: refreshSessions,
    setSessionStatus,
    resetSession,
    setSessionTransport,
  } = useSessions();
  const { devices: homeWorkerDevices } = useHomeWorkerDevices();
  const { metaStatus, refresh: refreshMetaStatus } = useMetaStatus();
  const [addSessionOpen, setAddSessionOpen] = useState(false);
  const [testingSessionId, setTestingSessionId] = useState<string | null>(null);

  // The OAuth callback lands back on the app with its outcome; show it once.
  useEffect(() => {
    const connected = takeFlash("meta_connected");
    const error = takeFlash("meta_error");
    if (!connected && !error) return;
    if (connected) toast.success(connected === "1" ? "Instagram account connected." : `Connected @${connected}.`);
    if (error) toast.error(error);
    refreshMetaStatus();
  }, [refreshMetaStatus]);

  async function disconnectMeta(id: string) {
    try {
      await apiFetch(`/api/meta/connections?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      toast.success("Instagram account disconnected.");
      refreshMetaStatus();
    } catch (err) {
      toast.error(friendlyError(err, "Failed to disconnect."));
    }
  }

  async function handleTestSession(id: string) {
    setTestingSessionId(id);
    try {
      const res = await apiFetch<{ ok: boolean; status: string; message?: string; flagged?: boolean }>(
        "/api/sessions/test", { method: "POST", body: JSON.stringify({ id }) }
      );
      if (res.ok) { toast.success("Session is healthy and authenticated."); }
      else if (res.flagged) { toast.error("Account or IP has been flagged by Instagram checkpoint challenge."); }
      else { toast.error(res.message || "Session test failed."); }
      refreshSessions();
    } catch (err) {
      toast.error(friendlyError(err, "Failed to test session."));
    } finally { setTestingSessionId(null); }
  }

  async function handleDeleteSession(id: string) {
    try {
      await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
      toast.success("Session deleted.");
      refreshSessions();
    } catch (err) {
      toast.error(friendlyError(err, "Failed to delete session."));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Your profile, how checks run, and the accounts you connect.</p>
      </div>

      <SetupChecklist onOpenTab={changeTab} />

      <Tabs value={tab} onValueChange={(value) => changeTab(value as SettingsTab)} className="gap-4">
        <TabsList className="h-auto w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Your name, how the app looks, and how long history is kept.</p>
          <AppearanceCard settings={settings} onSaved={refresh} />

          <Card size="sm">
            <CardHeader>
              <CardTitle>Your account</CardTitle>
            </CardHeader>
            {!settings ? (
              <CardContent>
                {settingsError ? (
                  <ErrorState title="Couldn't load your account" message={settingsError} onRetry={refresh} />
                ) : (
                  <LoadingState rows={2} />
                )}
              </CardContent>
            ) : (
              <AccountForm key={settings.id} settings={settings} onSaved={refresh} />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="monitoring" className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">When checks run and how many accounts you can watch.</p>
          {settings && (
            <CheckScheduleCard
              key={`${settings.timezone}-${settings.sleepEnabled}-${settings.sleepStartHour}-${settings.sleepEndHour}`}
              settings={settings}
              onSaved={refresh}
            />
          )}

          <TargetLimitCard />
        </TabsContent>

        <TabsContent value="connections" className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Connect Instagram so reels can be posted, and optionally add extra logins for stories and follower lists.</p>
          <InstagramPostingCard />

          <Card size="sm">
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <CardTitle>Extra Instagram logins</CardTitle>
                  <CardDescription className="text-xs">
                    Optional. Lets the app see stories, follower lists and reel videos. Use a spare account, never
                    your main one.
                  </CardDescription>
                </div>
                <Button onClick={() => setAddSessionOpen(true)} size="sm" className="w-fit">
                  <Plus className="size-3.5 mr-1" /> Add login
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {sessionsLoading && !sessions ? (
                <LoadingState rows={2} />
              ) : sessionsError && !sessions ? (
                <ErrorState title="Couldn't load your sessions" message={sessionsError} onRetry={refreshSessions} />
              ) : !sessions || sessions.length === 0 ? (
                <div className="rounded-lg border border-dashed p-5 text-center">
                  <p className="text-sm text-muted-foreground">
                    No extra logins yet. You can skip this: new posts and profile changes work without one. Add a
                    spare account only if you want stories, follower lists or reel videos.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setAddSessionOpen(true)}
                  >
                    <Plus className="size-3.5 mr-1" /> Add login
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {poolHealth && poolHealth.total > 0 && (
                    <div className="text-xs text-muted-foreground font-medium pb-1.5 border-b">
                      Logins: {poolHealth.active} working &middot; {poolHealth.cooling} resting &middot; {poolHealth.flagged} need attention
                    </div>
                  )}
                  {sessions.map((sess) => {
                    // ACTIVE alone hides a burner that is resting after a warning.
                    const resting = sess.status === "ACTIVE" && !!sess.cooldownUntil && new Date(sess.cooldownUntil) > new Date();
                    return (
                      <div key={sess.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border p-3">
                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-sm">@{sess.username}</span>
                            <Badge variant={resting ? "outline" : sess.status === "ACTIVE" ? "success" : sess.status === "FLAGGED" ? "destructive" : "outline"}
                              className="text-[11px] px-1.5 py-0" >
                              {resting ? "RESTING" : sess.status}
                            </Badge>
                            <Badge variant="secondary" className="text-[11px] px-1.5 py-0">
                              {sess.authMethod}
                            </Badge>
                            {sess.transport === "HOME_WORKER" ? (
                              <Badge variant="outline" className="text-[11px] px-1.5 py-0">
                                Home worker
                              </Badge>
                            ) : sess.hasProxy ? (
                              <Badge variant="outline" className="text-[11px] px-1.5 py-0">
                                Proxy
                              </Badge>
                            ) : null}
                          </div>
                          {sess.lastErrorMessage && (
                            <p className="text-xs text-destructive text-wrap ">{sess.lastErrorMessage}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {sess.lastTestedAt
                              ? `Tested ${formatDistanceToNow(new Date(sess.lastTestedAt), { addSuffix: true })}`
                              : "Not tested yet"}
                            {" · "}
                            {sess.status === "ACTIVE" && !resting && "In rotation"}
                            {resting && `Resting until ${new Date(sess.cooldownUntil!).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} (about ${formatDistanceToNow(new Date(sess.cooldownUntil!))})`}
                            {sess.status === "PAUSED" && "Paused"}
                            {sess.status === "FLAGGED" && "Needs manual reset"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 self-end sm:self-auto flex-wrap justify-end">
                          <Select
                            value={sess.transport === "HOME_WORKER" ? sess.homeWorkerDeviceId ?? "" : "PROXY"}
                            onValueChange={(value) => {
                              const next = value === "PROXY"
                                ? setSessionTransport(sess.id, "PROXY")
                                : setSessionTransport(sess.id, "HOME_WORKER", value);
                              next.catch((err) => toast.error(friendlyError(err, "Couldn't change transport.")));
                            }}
                          >
                            <SelectTrigger className="h-7 w-38 text-xs">
                              <SelectValue placeholder="Transport" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="PROXY">Webshare proxy</SelectItem>
                              {homeWorkerDevices?.filter((d) => d.status === "ACTIVE").map((d) => (
                                <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {sess.status === "FLAGGED" && (
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => resetSession(sess.id).catch((err) => toast.error(friendlyError(err, "Couldn't reset that session.")))}>
                              Reset
                            </Button>
                          )}
                          {sess.status !== "FLAGGED" && (
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() =>
                              setSessionStatus(sess.id, sess.status === "ACTIVE" ? "PAUSED" : "ACTIVE").catch((err) =>
                                toast.error(friendlyError(err, "Couldn't update that session.")),
                              )
                            }>
                              {sess.status === "ACTIVE" ? "Pause" : "Resume"}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={testingSessionId === sess.id}
                            onClick={() => handleTestSession(sess.id)}
                          >
                            {testingSessionId === sess.id ? (
                              <Loader2 className="size-3 animate-spin mr-1" />
                            ) : (
                              <Activity className="size-3 mr-1" />
                            )}
                            Test
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={() => handleDeleteSession(sess.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <AIKeysCard className="pb-16!" />
        </TabsContent>

        <TabsContent value="advanced" className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Most people never need these. Open this tab only if you know you need one of them.</p>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Facebook-linked Instagram (official API)</CardTitle>
              <CardDescription className="text-xs">
                For Instagram Business or Creator accounts linked to a Facebook Page. Most people can skip this.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {metaStatus && !metaStatus.configured && (
                <Alert>
                  <AlertTriangle />
                  <AlertDescription>
                    The server has no Meta app configured. Set <code>META_APP_ID</code> and{" "}
                    <code>META_APP_SECRET</code> before connecting.
                  </AlertDescription>
                </Alert>
              )}
              {metaStatus?.mode === "STEALTH" && (
                <Alert>
                  <AlertTriangle />
                  <AlertDescription>
                    Still running the legacy scraper (<code>INSTAGRAM_PROVIDER_MODE=STEALTH</code>). Remove
                    that override to use the official API.
                  </AlertDescription>
                </Alert>
              )}
              {metaStatus?.connection ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div className="flex flex-col gap-1 text-sm">
                    <span className="flex items-center gap-2">
                      {metaStatus.connection.status === "ACTIVE" ? (
                        <CheckCircle2 className="size-4 text-success" />
                      ) : (
                        <AlertTriangle className="size-4 text-destructive" />
                      )}
                      {metaStatus.connection.igUsername
                        ? `@${metaStatus.connection.igUsername}`
                        : metaStatus.connection.externalUserId}
                      <Badge variant="outline" className="text-[11px] px-1.5 py-0">{metaStatus.connection.status}</Badge>
                    </span>
                    {metaStatus.connection.expiresAt && (
                      <span className="text-xs text-muted-foreground">
                        Token renews automatically · expires{" "}
                        {formatDistanceToNow(new Date(metaStatus.connection.expiresAt), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => disconnectMeta(metaStatus.connection!.id)}>
                    <Trash2 className="size-3.5" /> Disconnect
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No account connected yet. Your Instagram account must be Business or Creator and linked
                  to a Facebook Page you manage.
                </p>
              )}
              <Button asChild variant="outline" size="sm" className="w-fit" disabled={!metaStatus?.configured}>
                <a href="/api/meta/connect">
                  <Link2 className="size-3.5" /> {metaStatus?.connection ? "Reconnect" : "Connect Instagram account"}
                </a>
              </Button>
            </CardContent>
          </Card>

          <HomeWorkerCard />

          <Card size="sm" className="mb-4!">
            <CardHeader>
              <CardTitle>System health</CardTitle>
              <CardDescription className="text-xs">What the app has been doing in the background lately.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 sm:px-5">
              {jobsLoading && !jobs ? (
                <LoadingState rows={4} className="px-4 sm:px-0" />
              ) : jobsError && !jobs ? (
                <ErrorState title="Couldn't load recent jobs" message={jobsError} onRetry={refreshJobs} className="mx-4 sm:mx-0" />
              ) : !jobs || jobs.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground">No job runs recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-8 text-xs">Type</TableHead>
                        <TableHead className="h-8 text-xs">Target</TableHead>
                        <TableHead className="h-8 text-xs">Status</TableHead>
                        <TableHead className="h-8 text-xs">Ran</TableHead>
                        <TableHead className="h-8 text-xs">Summary</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobs.map((job) => (
                        <TableRow key={job.id}>
                          <TableCell className="py-1.5 text-xs">{job.type.replace(/_/g, " ")}</TableCell>
                          <TableCell className="py-1.5 text-xs">{job.target ? `@${job.target.username}` : "—"}</TableCell>
                          <TableCell className="py-1.5">
                            <Badge variant={JOB_STATUS_VARIANT[job.status]} className="text-[11px] px-1.5 py-0">{job.status}</Badge>
                          </TableCell>
                          <TableCell className="py-1.5 text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(job.runAt), { addSuffix: true })}
                          </TableCell>
                          <TableCell className="py-1.5 text-xs text-muted-foreground">{job.resultSummary ?? job.lastError ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
            <CardFooter>
              <Button variant="outline" size="sm" onClick={refreshJobs}>
                Refresh
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      <AddSessionDialog
        open={addSessionOpen}
        onOpenChange={setAddSessionOpen}
        onCreated={refreshSessions}
      />
    </div>
  );
}

function AccountForm({ settings, onSaved }: { settings: UserSettings; onSaved: () => void }) {
  const [name, setName] = useState(settings.name ?? "");
  const [retentionDays, setRetentionDays] = useState(settings.retentionDays);
  const [saving, setSaving] = useState(false);

  async function saveAccount(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/settings", { method: "PATCH", body: JSON.stringify({ name, retentionDays }) });
      toast.success("Settings saved.");
      onSaved();
    } catch (err) {
      toast.error(friendlyError(err, "Failed to save settings."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={saveAccount}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Email</Label>
          <Input value={settings.email} disabled className="h-9" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name" className="text-xs">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="retention" className="text-xs">Keep history for (days)</Label>
          <Input
            id="retention"
            type="number"
            min={1}
            max={3650}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="h-9 max-w-32"
          />
          <p className="text-xs text-muted-foreground">
            Older activity is deleted automatically. The default is 90 days.
          </p>
        </div>
      </CardContent>
      <CardFooter>
        <Button type="submit" size="sm" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Save changes
        </Button>
      </CardFooter>
    </form>
  );
}
