"use client";

import dynamic from "next/dynamic";
import { preload } from "swr";
import { Bell, Clapperboard, HardDrive, LayoutDashboard, Settings, Target, type LucideIcon } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { PageSkeleton } from "@/components/common/page-skeleton";
import { DashboardPageClient } from "@/features/monitoring/components/dashboard-page-client";
import { TargetsTab } from "@/features/targets/components/targets-tab";
import {
  CHANNELS_KEY,
  EVENTS_KEY,
  NICHE_KEY,
  SETTINGS_KEY,
  STORAGE_KEY,
  TARGETS_KEY,
  TARGET_QUOTA_KEY,
} from "@/lib/swr-keys";
import type { AppTab, Screen } from "@/features/shell/navigation";

export const NAV_ITEMS: { tab: AppTab; label: string; icon: LucideIcon }[] = [
  { tab: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { tab: "targets", label: "Targets", icon: Target },
  { tab: "studio", label: "Studio", icon: Clapperboard },
  { tab: "storage", label: "Storage", icon: HardDrive },
  { tab: "notifications", label: "Notifications", icon: Bell },
  { tab: "settings", label: "Settings", icon: Settings },
];

export const TAB_LABELS = Object.fromEntries(NAV_ITEMS.map((i) => [i.tab, i.label])) as Record<AppTab, string>;

// Dashboard and the Targets list are the screens the server pre-fills with data, so
// they're imported directly: a lazily loaded tab sits behind a loading boundary, and
// on the server that streams it hidden until a script reveals it, which would undo
// the "real data in the first paint". Every other tab is its own code chunk, loaded
// the first time it's opened (or hovered), and they all load in the background once
// the page is idle.
const loaders = {
  studio: () => import("@/features/studio/components/studio-tab").then((m) => m.StudioTab),
  storage: () => import("@/features/storage/components/storage-view").then((m) => m.StorageView),
  notifications: () => import("@/features/notifications/components/notifications-view").then((m) => m.NotificationsView),
  settings: () => import("@/features/account/components/settings-view").then((m) => m.SettingsView),
};

const pageSkeleton = () => <PageSkeleton />;

export const TabComponents = {
  dashboard: DashboardPageClient,
  targets: TargetsTab,
  // Renders its own panes, so its placeholder brings the pane padding.
  studio: dynamic(loaders.studio, { loading: () => <div className="p-3 sm:p-6"><PageSkeleton stats={false} cards={3} /></div> }),
  storage: dynamic(loaders.storage, { loading: pageSkeleton }),
  notifications: dynamic(loaders.notifications, { loading: () => <PageSkeleton stats={false} cards={2} /> }),
  settings: dynamic(loaders.settings, { loading: () => <PageSkeleton stats={false} cards={3} /> }),
};

/** What each tab asks the API for first, so a hover can start those requests early. */
const FIRST_DATA: Record<AppTab, string[]> = {
  dashboard: [TARGETS_KEY, EVENTS_KEY],
  targets: [TARGETS_KEY, TARGET_QUOTA_KEY],
  studio: [NICHE_KEY, TARGET_QUOTA_KEY],
  storage: [STORAGE_KEY],
  notifications: [CHANNELS_KEY],
  settings: [SETTINGS_KEY],
};

const prefetched = new Set<AppTab>();

/**
 * Warms a tab before it's opened: its code chunk, and (once per page load) its first
 * data. After that the tab's own SWR hooks keep their data fresh.
 */
export function prefetchTab(tab: AppTab, screen?: Screen) {
  if (tab in loaders) loaders[tab as keyof typeof loaders]().catch(() => undefined);
  if (screen?.tab === tab || prefetched.has(tab)) return;
  prefetched.add(tab);
  for (const key of FIRST_DATA[tab]) preload(key, apiFetch).catch(() => undefined);
}

/** Loads every tab's code in the background once the page is idle, so later switches never wait. */
export function prefetchAllTabCode() {
  for (const load of Object.values(loaders)) load().catch(() => undefined);
}
