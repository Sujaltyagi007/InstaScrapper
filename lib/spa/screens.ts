/**
 * The app is one page at "/". What it shows is a `Screen`: a tab plus, for some
 * tabs, a view inside it. This module has NO "use client" directive because the
 * proxy (old links), the server page (first paint) and the browser all share it.
 *
 * A screen's "path" (`/targets/<id>`, `/studio/reels/<id>`, ...) is only a
 * serialization: it's what an old link or a push notification carries, and what
 * the `spa-screen` cookie stores so a refresh reopens the same screen. The
 * address bar itself always stays "/".
 */
import { SETTINGS_TABS, type SettingsTab } from "@/features/account/lib/settings-tabs";

export const APP_TABS = ["dashboard", "targets", "studio", "storage", "notifications", "settings"] as const;
export type AppTab = (typeof APP_TABS)[number];

export type Screen =
  | { tab: "dashboard" | "storage" | "notifications" }
  | { tab: "targets"; view?: { kind: "new" } | { kind: "target"; id: string } }
  | { tab: "studio"; reelId?: string }
  | { tab: "settings"; section?: SettingsTab; anchor?: string };

/** Last screen per browser, read by the server so a refresh paints the right tab. */
export const SCREEN_COOKIE = "spa-screen";

/** One-shot params an OAuth return carries (they show a toast once). */
const FLASH_KEYS = ["ig_connected", "ig_error", "meta_connected", "meta_error"] as const;
export type FlashParams = Partial<Record<(typeof FLASH_KEYS)[number], string>>;

const TAB_ROOTS: Record<string, AppTab> = {
  "": "dashboard",
  targets: "targets",
  studio: "studio",
  storage: "storage",
  notifications: "notifications",
  settings: "settings",
};

// Database ids (cuid) and nothing else, so a crafted link can't smuggle anything.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ANCHOR_RE = /^[a-z0-9-]{1,40}$/;
/** Settings cards that links point at, and the sub-tab each one lives on. */
const ANCHOR_SECTIONS: Record<string, SettingsTab> = { "account-limit": "monitoring" };

/** True for the old page paths the proxy should hand off to "/". */
export function isScreenPath(pathname: string): boolean {
  return pathname !== "/" && parseScreenPath(pathname) !== null;
}

/**
 * Parses an old-style path (+ optional query/hash) into a screen. Returns null
 * for anything that isn't one of the app's screens. Unknown ids/sections fall
 * back to the tab's root instead of failing.
 */
export function parseScreenPath(input: string): { screen: Screen; flash: FlashParams } | null {
  let url: URL;
  try {
    url = new URL(input, "http://local");
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const tab = TAB_ROOTS[parts[0] ?? ""];
  if (!tab) return null;

  const flash: FlashParams = {};
  for (const key of FLASH_KEYS) {
    const value = url.searchParams.get(key);
    if (value) flash[key] = value.slice(0, 300);
  }

  const screen = ((): Screen | null => {
    switch (tab) {
      case "dashboard":
        return parts.length === 0 ? { tab } : null;
      case "targets":
        if (parts.length === 1) return { tab };
        if (parts.length !== 2) return null;
        if (parts[1] === "new") return { tab, view: { kind: "new" } };
        return ID_RE.test(parts[1]) ? { tab, view: { kind: "target", id: parts[1] } } : { tab };
      case "studio":
        if (parts.length === 1) return { tab };
        if (parts.length === 3 && parts[1] === "reels") return ID_RE.test(parts[2]) ? { tab, reelId: parts[2] } : { tab };
        return null;
      case "settings": {
        if (parts.length !== 1) return null;
        const named = url.searchParams.get("tab");
        const hash = url.hash.slice(1);
        const anchor = ANCHOR_RE.test(hash) ? hash : undefined;
        const section: SettingsTab | undefined = SETTINGS_TABS.includes(named as SettingsTab)
          ? (named as SettingsTab)
          : anchor && ANCHOR_SECTIONS[anchor]
            ? ANCHOR_SECTIONS[anchor]
            : flash.meta_connected || flash.meta_error
              ? "advanced"
              : flash.ig_connected || flash.ig_error
                ? "connections"
                : undefined;
        return { tab, ...(section ? { section } : {}), ...(anchor ? { anchor } : {}) };
      }
      default:
        return parts.length === 1 ? { tab } : null;
    }
  })();

  return screen ? { screen, flash } : null;
}

/** The old-style path for a screen: used for link hrefs (open in new tab) and the cookie. */
export function screenToPath(screen: Screen): string {
  switch (screen.tab) {
    case "dashboard":
      return "/";
    case "targets":
      if (!screen.view) return "/targets";
      return screen.view.kind === "new" ? "/targets/new" : `/targets/${screen.view.id}`;
    case "studio":
      return screen.reelId ? `/studio/reels/${screen.reelId}` : "/studio";
    case "settings":
      return `/settings${screen.section ? `?tab=${screen.section}` : ""}${screen.anchor ? `#${screen.anchor}` : ""}`;
    default:
      return `/${screen.tab}`;
  }
}

export function sameScreen(a: Screen, b: Screen): boolean {
  return screenToPath(a) === screenToPath(b);
}
