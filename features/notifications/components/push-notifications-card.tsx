"use client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/fetcher";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { friendlyError } from "@/lib/friendly-error";
import useSWR, { mutate as globalMutate } from "swr";
import { CHANNELS_KEY, PUSH_KEY } from "@/lib/swr-keys";
import { ErrorState } from "@/components/common/error-state";
import { LoadingState } from "@/components/common/loading-state";
import { InstallAppButton } from "@/components/pwa/install-app-button";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BellRing, Loader2, Monitor, Send, Smartphone, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { currentPushSubscription, isIos, isStandalone, pushSupported, subscribeThisDevice } from "@/lib/pwa/client";

interface Device {
  id: string;
  endpoint: string;
  label: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  failureCount: number;
}

interface PushState {
  configured: boolean;
  publicKey: string | null;
  preferences: { channelId: string | null; enabled: boolean; eventTypes: string[] };
  devices: Device[];
}

/** User-facing groups of event types. An empty filter on the channel means "everything". */
const GROUPS: { label: string; types: string[] }[] = [
  { label: "New posts & reels", types: ["NEW_MEDIA", "NEW_REEL", "MEDIA_UPDATED"] },
  { label: "Stories", types: ["NEW_STORY"] },
  { label: "Profile changes", types: ["PROFILE_CHANGED", "ACCOUNT_RENAMED"] },
  { label: "Follower changes", types: ["FOLLOWER_COUNT_CHANGED", "FOLLOWING_COUNT_CHANGED", "FOLLOWER_CHURN"] },
  { label: "Collab posts", types: ["COLLAB_POST_LEAKED"] },
  { label: "Problems", types: ["ACCOUNT_UNAVAILABLE", "RATE_LIMITED", "SESSION_FLAGGED"] },
];
const ALL_TYPES = GROUPS.flatMap((g) => g.types);

const noopSubscribe = () => () => {};

/** Notification.permission, kept live when the user changes it in site settings. */
function subscribePermission(onChange: () => void) {
  let status: PermissionStatus | null = null;
  navigator.permissions
    ?.query({ name: "notifications" })
    .then((s) => {
      status = s;
      s.addEventListener("change", onChange);
    })
    .catch(() => {});
  return () => status?.removeEventListener("change", onChange);
}
const readPermission = (): NotificationPermission | "unsupported" =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

export function PushNotificationsCard() {
  const { data, error, isLoading, mutate } = useSWR<PushState>(PUSH_KEY);
  const supported = useSyncExternalStore(noopSubscribe, pushSupported, () => true);
  const secure = useSyncExternalStore(noopSubscribe, () => window.isSecureContext, () => true);
  const ios = useSyncExternalStore(noopSubscribe, isIos, () => false);
  const standalone = useSyncExternalStore(noopSubscribe, isStandalone, () => false);
  const permission = useSyncExternalStore(subscribePermission, readPermission, () => "default" as const);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState<"on" | "off" | "test" | null>(null);
  const healed = useRef(false);

  // Which subscription (if any) this browser holds.
  useEffect(() => {
    currentPushSubscription()
      .then((s) => setEndpoint(s?.endpoint ?? null))
      .catch(() => setEndpoint(null));
  }, []);

  // Self-heal: this browser is subscribed but the server doesn't list it (e.g. another
  // account signed in here before, or the row was removed). Re-register it quietly.
  useEffect(() => {
    if (healed.current || !data?.configured || !endpoint || permission !== "granted") return;
    if (data.devices.some((d) => d.endpoint === endpoint)) return;
    healed.current = true;
    currentPushSubscription()
      .then((sub) =>
        sub ? apiFetch(PUSH_KEY, { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) }) : null,
      )
      .then(() => mutate())
      .catch(() => {});
  }, [data, endpoint, permission, mutate]);

  const thisDevice = data?.devices.find((d) => d.endpoint === endpoint) ?? null;
  const otherDevices = data?.devices.filter((d) => d.endpoint !== endpoint) ?? [];

  async function turnOn() {
    if (!data?.publicKey) return;
    setBusy("on");
    try {
      // Asked only here, after the user tapped "Turn on" — never on page load.
      const result = permission === "granted" ? "granted" : await Notification.requestPermission();
      if (result !== "granted") {
        toast.message("Notifications stay off. You can turn them on here anytime.");
        return;
      }
      const sub = await subscribeThisDevice(data.publicKey);
      await apiFetch(PUSH_KEY, { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) });
      setEndpoint(sub.endpoint);
      await mutate();
      globalMutate(CHANNELS_KEY); // the "Browser push" channel now shows in the channel list
      toast.success("Notifications are on for this device.");
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't turn on notifications. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  async function turnOff() {
    setBusy("off");
    const sub = await currentPushSubscription().catch(() => null);
    const ep = sub?.endpoint ?? endpoint;
    // Optimistic: the device leaves the list at once.
    mutate((cur) => cur && { ...cur, devices: cur.devices.filter((d) => d.endpoint !== ep) }, { revalidate: false });
    setEndpoint(null);
    try {
      await sub?.unsubscribe();
      if (ep) await apiFetch(`${PUSH_KEY}?endpoint=${encodeURIComponent(ep)}`, { method: "DELETE" });
      toast.success("Notifications are off for this device.");
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't turn notifications off. Please try again."));
    } finally {
      await mutate();
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy("test");
    try {
      await apiFetch("/api/push/test", { method: "POST", body: JSON.stringify({ endpoint }) });
      toast.success("Test sent. It should appear in a few seconds.");
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't send the test."));
    } finally {
      setBusy(null);
    }
  }

  async function removeDevice(id: string) {
    mutate((cur) => cur && { ...cur, devices: cur.devices.filter((d) => d.id !== id) }, { revalidate: false });
    try {
      await apiFetch(`${PUSH_KEY}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't remove that device."));
    } finally {
      mutate();
    }
  }

  async function savePreferences(prefs: { enabled?: boolean; eventTypes?: string[] }) {
    mutate((cur) => cur && { ...cur, preferences: { ...cur.preferences, ...prefs } }, { revalidate: false });
    try {
      await apiFetch("/api/push/preferences", { method: "PATCH", body: JSON.stringify(prefs) });
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't save that preference."));
    } finally {
      mutate();
      globalMutate(CHANNELS_KEY);
    }
  }

  function toggleGroup(types: string[]) {
    if (!data) return;
    const current = new Set(data.preferences.eventTypes.length ? data.preferences.eventTypes : ALL_TYPES);
    const on = types.every((t) => current.has(t));
    types.forEach((t) => (on ? current.delete(t) : current.add(t)));
    if (current.size === 0) {
      toast.message("Keep at least one type, or switch push off with the toggle above.");
      return;
    }
    const all = ALL_TYPES.every((t) => current.has(t));
    savePreferences({ eventTypes: all ? [] : [...current] });
  }

  const selected = new Set(data?.preferences.eventTypes.length ? data.preferences.eventTypes : ALL_TYPES);
  const hasDevices = (data?.devices.length ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="size-4" /> Push notifications
            </CardTitle>
            <CardDescription>Alerts on your phone or computer, even when the app is closed.</CardDescription>
          </div>
          {data && hasDevices && (
            <Switch
              className="mt-0.5 shrink-0"
              checked={data.preferences.enabled}
              onCheckedChange={(v) => savePreferences({ enabled: v })}
              aria-label="Push notifications on or off"
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading && !data ? (
          <LoadingState rows={2} />
        ) : error && !data ? (
          <ErrorState title="Couldn't load push settings" message={friendlyError(error)} onRetry={() => mutate()} />
        ) : !data ? null : !data.configured ? (
          <Note>Push isn&apos;t set up on the server yet. It needs the VAPID keys in the environment.</Note>
        ) : (
          <>
            {/* This device */}
            {!secure ? (
              <Note>Notifications need a secure (https) connection. They&apos;ll work on your live site.</Note>
            ) : !supported ? (
              ios && !standalone ? (
                <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm">
                  <p>On iPhone and iPad, install the app first, then turn notifications on from inside it.</p>
                  <InstallAppButton className="w-fit border" />
                </div>
              ) : (
                <Note>This browser doesn&apos;t support push notifications. Try Chrome, Edge, Firefox or Safari.</Note>
              )
            ) : permission === "denied" ? (
              <Note tone="warn">
                Notifications are blocked for this site. {ios ? "Open Settings → Notifications → IG Monitor" : "Click the icon next to the address bar → Site settings → Notifications"} and set it to Allow, then come back here.
              </Note>
            ) : thisDevice ? (
              <DeviceRow device={thisDevice} current>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy !== null} onClick={sendTest}>
                  {busy === "test" ? <Loader2 className="animate-spin" /> : <Send />} Test
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" disabled={busy !== null} onClick={turnOff}>
                  {busy === "off" ? <Loader2 className="animate-spin" /> : null} Turn off
                </Button>
              </DeviceRow>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">Get notified on this device when something changes.</p>
                <Button size="sm" className="h-8 shrink-0" disabled={busy !== null} onClick={turnOn}>
                  {busy === "on" ? <Loader2 className="animate-spin" /> : <BellRing />} Turn on
                </Button>
              </div>
            )}

            {/* Other devices */}
            {otherDevices.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">Other devices</p>
                <ul className="divide-y rounded-lg border">
                  {otherDevices.map((d) => (
                    <li key={d.id} className="px-3">
                      <DeviceRow device={d}>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-muted-foreground"
                          aria-label={`Remove ${d.label ?? "device"}`}
                          onClick={() => removeDevice(d.id)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </DeviceRow>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Preferences */}
            {hasDevices && (
              <div className={cn("flex flex-col gap-2", !data.preferences.enabled && "pointer-events-none opacity-50")}>
                <p className="text-xs font-medium text-muted-foreground">Notify me about</p>
                <div className="flex flex-wrap gap-1.5">
                  {GROUPS.map((g) => {
                    const on = g.types.every((t) => selected.has(t));
                    return (
                      <button
                        key={g.label}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleGroup(g.types)}
                        className={cn(
                          "h-7 rounded-full border px-2.5 text-xs font-medium transition-colors",
                          on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {g.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">Account alerts and &quot;reel ready&quot; always come through.</p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DeviceRow({ device, current, children }: { device: Device; current?: boolean; children: React.ReactNode }) {
  const mobile = /Android|iPhone|iPad/.test(device.label ?? "");
  const Icon = mobile ? Smartphone : Monitor;
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {device.label ?? "Unknown device"}
          {current && <span className="ml-1.5 text-xs font-normal text-emerald-600 dark:text-emerald-400">· this device</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground" suppressHydrationWarning>
          {device.lastSuccessAt
            ? `Last notified ${formatDistanceToNow(new Date(device.lastSuccessAt), { addSuffix: true })}`
            : `Added ${formatDistanceToNow(new Date(device.createdAt), { addSuffix: true })}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">{children}</div>
    </div>
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <p
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        tone === "warn"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "border-dashed text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}
