"use client";

/**
 * In-page navigation for the single-page app. The address bar always stays "/".
 *
 * - The current screen lives in a module-level store (read with useSyncExternalStore).
 * - Every navigation pushes a browser-history entry with no URL change, carrying the
 *   screen under `__spa`, so the phone's Back button walks back through screens.
 *   Next.js keeps custom keys on natively pushed entries (same trick as
 *   use-simulator-layer.ts) and, since the URL never changes, nothing reloads.
 * - The screen is mirrored to the `spa-screen` cookie so a refresh (or a fresh visit)
 *   is server-rendered on the same screen.
 * - Up to MAX_ALIVE tabs stay mounted (hidden with <Activity>), most recent first.
 */
import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import {
  APP_TABS,
  SCREEN_COOKIE,
  parseScreenPath,
  sameScreen,
  screenToPath,
  type AppTab,
  type FlashParams,
  type Screen,
} from "@/lib/spa/screens";

export type { AppTab, Screen } from "@/lib/spa/screens";

const HISTORY_KEY = "__spa";
/** Tabs kept alive at once; the one used longest ago is dropped beyond this. */
const MAX_ALIVE = 4;

export interface NavState {
  screen: Screen;
  /** The screen we navigated here from (for "Back to …" buttons). */
  from: Screen | null;
  /** Mounted tabs, most recently used first. */
  alive: AppTab[];
  /** Last screen shown in each tab, so switching back restores it. */
  last: Partial<Record<AppTab, Screen>>;
  /** Position of this entry in the app's own history (0 = the page load). */
  idx: number;
}

interface HistoryEntry {
  screen: Screen;
  from: Screen | null;
  idx: number;
}

let state: NavState | null = null;
let flash: FlashParams = {};
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function isScreen(value: unknown): value is Screen {
  if (!value || typeof value !== "object") return false;
  const tab = (value as { tab?: unknown }).tab;
  if (!APP_TABS.includes(tab as AppTab)) return false;
  // Re-validate through the parser so a tampered history entry can't carry odd ids.
  return parseScreenPath(screenToPath(value as Screen)) !== null;
}

function readEntry(raw: unknown): HistoryEntry | null {
  const entry = (raw as Record<string, unknown> | null)?.[HISTORY_KEY] as Partial<HistoryEntry> | undefined;
  if (!entry || !isScreen(entry.screen) || typeof entry.idx !== "number") return null;
  return { screen: entry.screen, from: isScreen(entry.from) ? entry.from : null, idx: entry.idx };
}

/** The `__spa` part of the current history entry, for other code that pushes entries (the simulator). */
export function currentHistoryEntry(): Record<string, unknown> {
  const entry = window.history.state?.[HISTORY_KEY];
  return entry ? { [HISTORY_KEY]: entry } : {};
}

function persist(screen: Screen) {
  // Anchors are a one-time scroll, not a place to come back to.
  const stored = screen.tab === "settings" && screen.anchor ? { ...screen, anchor: undefined } : screen;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${SCREEN_COOKIE}=${encodeURIComponent(screenToPath(stored))}; path=/; max-age=2592000; samesite=lax${secure}`;
}

function apply(entry: HistoryEntry) {
  const prev = state!;
  const tab = entry.screen.tab;
  state = {
    screen: entry.screen,
    from: entry.from,
    idx: entry.idx,
    alive: [tab, ...prev.alive.filter((t) => t !== tab)].slice(0, MAX_ALIVE),
    last: { ...prev.last, [tab]: entry.screen },
  };
  persist(entry.screen);
  emit();
}

function onPopState(event: PopStateEvent) {
  const entry = readEntry(event.state);
  // Entries without our key aren't ours (e.g. before the app loaded); leave the screen.
  if (entry && state) apply(entry);
}

function initialState(screen: Screen): NavState {
  return { screen, from: null, idx: 0, alive: [screen.tab], last: { [screen.tab]: screen } };
}

/** Called once after hydration with the screen the server rendered. */
function init(screen: Screen, initialFlash: FlashParams) {
  if (state) return;
  state = initialState(screen);
  flash = initialFlash;
  window.addEventListener("popstate", onPopState);

  // A refresh keeps this browser tab's own history entry: if it points elsewhere
  // (another browser tab moved the cookie meanwhile), it wins. A link with
  // one-shot params (an OAuth return) always wins over it.
  const saved = readEntry(window.history.state);
  const hasFlash = Object.keys(initialFlash).length > 0;
  if (saved && !hasFlash) {
    apply(saved);
    return;
  }

  // A "#card" in an old link (e.g. /settings#account-limit) never reaches the server,
  // and browsers keep it across the hand-off redirect: use it here, then drop it so
  // the address bar is a plain "/".
  let first = screen;
  const hash = window.location.hash;
  if (hash) {
    const withHash = parseScreenPath(screenToPath(screen) + hash);
    if (withHash) first = withHash.screen;
  }
  const entry: HistoryEntry = { screen: first, from: null, idx: 0 };
  window.history.replaceState({ ...window.history.state, [HISTORY_KEY]: entry }, "", hash ? "/" : undefined);
  if (first !== screen) apply(entry);
  else {
    persist(screen);
    emit();
  }
}

export function navigate(screen: Screen, opts: { replace?: boolean } = {}) {
  if (!state) return;
  if (sameScreen(screen, state.screen)) return;
  const entry: HistoryEntry = {
    screen,
    from: opts.replace ? state.from : state.screen,
    idx: opts.replace ? state.idx : state.idx + 1,
  };
  // Only our key: a pushed entry must not carry e.g. the simulator's open state.
  if (opts.replace) window.history.replaceState({ [HISTORY_KEY]: entry }, "");
  else window.history.pushState({ [HISTORY_KEY]: entry }, "");
  apply(entry);
}

/** Opens a tab where the user left it; tapping the tab you're on returns to its start. */
export function openTab(tab: AppTab) {
  if (!state) return;
  if (state.screen.tab === tab) {
    navigate({ tab } as Screen);
    return;
  }
  navigate(state.last[tab] ?? ({ tab } as Screen));
}

/**
 * "Back to …" buttons: goes back in history when that's where we came from (so the
 * list keeps its place and Back/forward stay consistent), otherwise opens the parent.
 */
export function goBackTo(parent: Screen) {
  if (!state) return;
  if (state.from && state.idx > 0 && sameScreen(state.from, parent)) window.history.back();
  else navigate(parent, { replace: true });
}

/** Opens an old-style path ("/targets/abc") — used for push notification clicks. */
export function openPath(path: string): boolean {
  const parsed = parseScreenPath(path);
  if (!parsed || !state) return false;
  navigate(parsed.screen);
  return true;
}

/** Returns and forgets a one-shot param from the link that opened the app. */
export function takeFlash<K extends keyof FlashParams>(key: K): string | undefined {
  const value = flash[key];
  delete flash[key];
  return value;
}

const InitialContext = createContext<NavState | null>(null);

export function NavigationProvider({
  initialScreen,
  initialFlash,
  children,
}: {
  initialScreen: Screen;
  initialFlash: FlashParams;
  children: ReactNode;
}) {
  // Stable for the server snapshot / hydration; the store takes over after init.
  const [initial] = useState(() => initialState(initialScreen));
  // Before paint, so a refresh restoring another screen doesn't flash the first one.
  useLayoutEffect(() => init(initialScreen, initialFlash), [initialScreen, initialFlash]);
  return <InitialContext.Provider value={initial}>{children}</InitialContext.Provider>;
}

export function useNavState(): NavState {
  const initial = useContext(InitialContext);
  if (!initial) throw new Error("useNavState must be used inside NavigationProvider");
  return useSyncExternalStore(
    subscribe,
    () => state ?? initial,
    () => initial,
  );
}

export function useScreen(): Screen {
  return useNavState().screen;
}

/** A "Back to …" link: returns to `to` the way the user came (see goBackTo). */
export function BackLink({ to, onClick, ...props }: Omit<ComponentProps<"a">, "href"> & { to: Screen }) {
  return (
    <a
      href={screenToPath(to)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        goBackTo(to);
      }}
      {...props}
    />
  );
}

/**
 * A real link (so middle-click / "open in new tab" works through the proxy hand-off),
 * but a plain click switches screens in place.
 */
export function AppLink({
  to,
  replace,
  onClick,
  ...props
}: Omit<ComponentProps<"a">, "href"> & { to: Screen; replace?: boolean }) {
  return (
    <a
      href={screenToPath(to)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to, { replace });
      }}
      {...props}
    />
  );
}
