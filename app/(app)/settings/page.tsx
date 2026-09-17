"use client";
import { toast } from "sonner";
import { apiFetch } from "@/lib/fetcher";
import { TargetLimitCard } from "@/features/account/components/target-limit-card";
import { CheckScheduleCard } from "@/features/account/components/check-schedule-card";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { useJobs } from "@/features/monitoring/hooks/use-jobs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LoadingState } from "@/components/common/loading-state";
import { useSessions } from "@/features/sessions/hooks/use-sessions";
import { useSettings, type UserSettings } from "@/hooks/use-settings";
import { AddSessionDialog } from "@/features/sessions/components/add-session-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Loader2, Link2, CheckCircle2, AlertTriangle, Plus, Activity, Trash2 } from "lucide-react";

interface MetaStatus {
  mock: boolean;
  connection: {
    id: string;
    status: string;
    accountType: string | null;
    lastVerifiedAt: string | null;
  } | null;
}

const JOB_STATUS_VARIANT: Record<string, "secondary" | "success" | "destructive" | "outline"> = {
  QUEUED: "secondary",
  RUNNING: "outline",
  SUCCEEDED: "success",
  FAILED: "destructive",
};

export default function SettingsPage() {
  const { settings, loading: settingsLoading, refresh } = useSettings();
  const { jobs, loading: jobsLoading, refresh: refreshJobs } = useJobs();
  const { sessions, poolHealth, loading: sessionsLoading, refresh: refreshSessions, setSessionStatus, resetSession } = useSessions();
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null);
  const [addSessionOpen, setAddSessionOpen] = useState(false);
  const [testingSessionId, setTestingSessionId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<MetaStatus>("/api/meta/status").then(setMetaStatus).catch(() => undefined);
  }, []);

  async function handleTestSession(id: string) {
    setTestingSessionId(id);
    try {
      const res = await apiFetch<{ ok: boolean; status: string; message?: string; flagged?: boolean }>(
        "/api/sessions/test",
        { method: "POST", body: JSON.stringify({ id }) }
      );
      if (res.ok) {
        toast.success("Session is healthy and authenticated.");
      } else if (res.flagged) {
        toast.error("Account or IP has been flagged by Instagram checkpoint challenge.");
      } else {
        toast.error(res.message || "Session test failed.");
      }
      refreshSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to test session.");
    } finally {
      setTestingSessionId(null);
    }
  }

  async function handleDeleteSession(id: string) {
    try {
      await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
      toast.success("Session deleted.");
      refreshSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete session.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account, integrations, and data retention.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle>Instagram Sessions & Stealth Engine</CardTitle>
              <CardDescription>
                Bypass bot detection with browser TLS (JA3/JA4) impersonation, session reuse, and automatic checkpoint health probing.
              </CardDescription>
            </div>
            <Button onClick={() => setAddSessionOpen(true)} size="sm" className="w-fit">
              <Plus className="size-4 mr-1.5" /> Connect Session
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {sessionsLoading ? (
            <LoadingState />
          ) : !sessions || sessions.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No Instagram sessions configured yet. Connect a session via browser import or cookies to enable stories, reels, private account detection, and follower churn.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setAddSessionOpen(true)}
              >
                <Plus className="size-4 mr-1.5" /> Connect Session
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {poolHealth && poolHealth.total > 0 && (
                <div className="text-sm text-muted-foreground font-medium pb-2 border-b mb-1">
                  Pool: {poolHealth.active} active &middot; {poolHealth.cooling} cooling &middot; {poolHealth.flagged} flagged
                </div>
              )}
              {sessions.map((sess) => (
                <div
                  key={sess.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm">@{sess.username}</span>
                      <Badge variant={
                        sess.status === "ACTIVE" ? "success"
                          : sess.status === "FLAGGED" ? "destructive" : "outline"
                      }
                      >
                        {sess.status}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {sess.authMethod}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        TLS: {sess.impersonateTarget}
                      </Badge>
                      {sess.proxyUrl && (
                        <Badge variant="outline" className="text-xs">
                          Proxy Active
                        </Badge>
                      )}
                    </div>
                    {sess.lastErrorMessage && (
                      <p className="text-xs text-destructive">{sess.lastErrorMessage}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {sess.lastTestedAt
                        ? `Tested ${formatDistanceToNow(new Date(sess.lastTestedAt), { addSuffix: true })}`
                        : "Not tested yet"}
                    </p>
                    <p className="text-xs font-medium">
                      {sess.status === "ACTIVE" && (!sess.cooldownUntil || new Date(sess.cooldownUntil) < new Date()) && "In rotation"}
                      {sess.status === "ACTIVE" && sess.cooldownUntil && new Date(sess.cooldownUntil) > new Date() && `Cooling down until ${new Date(sess.cooldownUntil).toLocaleTimeString()}`}
                      {sess.status === "PAUSED" && "Paused (excluded from pool)"}
                      {sess.status === "FLAGGED" && "Flagged — manual reset required"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap justify-end">
                    {sess.status === "FLAGGED" && (
                      <Button variant="outline" size="sm" onClick={() => resetSession(sess.id)}>
                        Reset
                      </Button>
                    )}
                    {sess.status !== "FLAGGED" && (
                      <Button variant="outline" size="sm" onClick={() => setSessionStatus(sess.id, sess.status === "ACTIVE" ? "PAUSED" : "ACTIVE")}>
                        {sess.status === "ACTIVE" ? "Pause" : "Resume"}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={testingSessionId === sess.id}
                      onClick={() => handleTestSession(sess.id)}
                    >
                      {testingSessionId === sess.id ? (
                        <Loader2 className="size-3.5 animate-spin mr-1.5" />
                      ) : (
                        <Activity className="size-3.5 mr-1.5" />
                      )}
                      Test Health
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => handleDeleteSession(sess.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AddSessionDialog
        open={addSessionOpen}
        onOpenChange={setAddSessionOpen}
        onCreated={refreshSessions}
      />

      <Card>
        <CardHeader>
          <CardTitle>Meta Graph API (Optional)</CardTitle>
          <CardDescription>Official Facebook Graph API integration for verified Business Discovery.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {metaStatus?.mock && (
            <Alert>
              <AlertTriangle />
              <AlertDescription>
                Running in mock mode (<code>MOCK_META_API=true</code>). For unmonitored live scraping, use the Stealth Engine above.
              </AlertDescription>
            </Alert>
          )}
          {metaStatus?.connection ? (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 text-success" />
                Connected {metaStatus.connection.accountType ? `(${metaStatus.connection.accountType})` : ""}
                <Badge variant="outline">{metaStatus.connection.status}</Badge>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No Meta Graph connection.</p>
          )}
          <Button asChild variant="outline" className="w-fit">
            <a href="/api/meta/connect">
              <Link2 /> {metaStatus?.connection ? "Reconnect" : "Connect Meta account"}
            </a>
          </Button>
        </CardContent>
      </Card>

      <TargetLimitCard />

      {settings && (
        <CheckScheduleCard
          key={`${settings.timezone}-${settings.sleepEnabled}-${settings.sleepStartHour}-${settings.sleepEndHour}`}
          settings={settings}
          onSaved={refresh}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        {settingsLoading || !settings ? (
          <CardContent>
            <LoadingState />
          </CardContent>
        ) : (
          // Keyed by user id so this subtree mounts fresh (with settings
          // already known) rather than syncing local form state from props
          // via an effect after the fact.
          <AccountForm key={settings.id} settings={settings} onSaved={refresh} />
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System health</CardTitle>
          <CardDescription>Recent background job runs (target checks, notifications, cleanup).</CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {jobsLoading ? (
            <LoadingState />
          ) : !jobs || jobs.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No job runs recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ran</TableHead>
                    <TableHead>Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>{job.type.replace(/_/g, " ")}</TableCell>
                      <TableCell>{job.target ? `@${job.target.username}` : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={JOB_STATUS_VARIANT[job.status]}>{job.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDistanceToNow(new Date(job.runAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{job.resultSummary ?? job.lastError ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="p-6 pt-0">
            <Button variant="outline" size="sm" onClick={refreshJobs}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>
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
      toast.error(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={saveAccount}>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Email</Label>
          <Input value={settings.email} disabled />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="retention">Data retention (days)</Label>
          <Input
            id="retention"
            type="number"
            min={1}
            max={3650}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Event and snapshot history older than this is deleted automatically. Default is 90 days.
          </p>
        </div>
      </CardContent>
      <CardFooter>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Save changes
        </Button>
      </CardFooter>
    </form>
  );
}
