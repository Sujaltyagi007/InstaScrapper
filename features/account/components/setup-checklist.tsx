"use client";
import Link from "next/link";
import useSWR from "swr";
import { useSyncExternalStore } from "react";
import { CheckCircle2, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTargetQuota } from "@/features/account/hooks/use-target-quota";
import type { SettingsTab } from "@/features/account/lib/settings-tabs";
import { useNotificationChannels } from "@/features/notifications/hooks/use-notification-channels";

const DISMISSED_KEY = "setupChecklistDismissed";

// A tiny store over localStorage, so the card can hide itself without an effect.
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}
function dismiss() {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Private browsing: it just comes back next visit.
  }
  listeners.forEach((listener) => listener());
}

interface Step {
  title: string;
  hint: string;
  done: boolean;
  optional?: boolean;
  action: { label: string; href: string } | { label: string; tab: SettingsTab };
}

/**
 * "Get started" for new users: the few things that make the app useful, each
 * with a button that goes straight there. Hides itself once the two required
 * steps are done, or when dismissed.
 */
export function SetupChecklist({ onOpenTab }: { onOpenTab: (tab: SettingsTab) => void }) {
  // Hidden on the server and until data arrives, so it never flashes and vanishes.
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);
  const { quota } = useTargetQuota();
  const { channels } = useNotificationChannels();
  const { data: posting } = useSWR<{ accounts: { id: string }[] }>("/api/ig/accounts");

  if (dismissed || !quota || !channels) return null;

  const steps: Step[] = [
    {
      title: "Add an Instagram account to watch",
      hint: "Paste a username and the app starts checking it for new posts.",
      done: quota.used > 0,
      action: { label: "Add account", href: "/targets/new" },
    },
    {
      title: "Get notified",
      hint: "Turn on phone or browser notifications so you hear about new posts.",
      done: channels.length > 0,
      action: { label: "Set up", href: "/notifications" },
    },
    {
      title: "Connect the account your reels are posted to",
      hint: "Only needed if you want the app to make reels for you.",
      done: (posting?.accounts.length ?? 0) > 0,
      optional: true,
      action: { label: "Connect", tab: "connections" },
    },
  ];
  const required = steps.filter((s) => !s.optional);
  if (required.every((s) => s.done)) return null;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>Get started</CardTitle>
            <CardDescription className="text-xs">
              {doneCount} of {steps.length} done
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" className="size-7" onClick={dismiss} aria-label="Hide this checklist">
            <X className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {steps.map((step) => (
          <div key={step.title} className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex min-w-0 items-start gap-2.5">
              {step.done ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {step.title}
                  {step.optional && <span className="ml-1.5 text-xs font-normal text-muted-foreground">Optional</span>}
                </p>
                <p className="text-xs text-muted-foreground">{step.hint}</p>
              </div>
            </div>
            {!step.done &&
              ("href" in step.action ? (
                <Button asChild size="sm" variant="outline" className="h-7 shrink-0 text-xs">
                  <Link href={step.action.href}>{step.action.label}</Link>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 text-xs"
                  onClick={() => onOpenTab((step.action as { tab: SettingsTab }).tab)}
                >
                  {step.action.label}
                </Button>
              ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
