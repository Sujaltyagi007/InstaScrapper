"use client";
import { useSyncExternalStore } from "react";
import { currentHistoryEntry } from "@/features/shell/navigation";

// The full-screen simulator keeps its state in the browser history, like Instagram:
// opening the sheet or a post pushes an entry, so the phone's Back button closes the
// post first, then the sheet. Every close goes through history.back(), so there's one
// source of truth. Next.js keeps custom keys when these entries are pushed (see
// "Native History API" in its docs) and no URL changes, so nothing reloads.
const KEY = "__igSim";

export interface SimulatorLayer {
  /** 0 = closed, 1 = profile, 2 = a post. */
  depth: number;
  postId: string | null;
}

const CLOSED: SimulatorLayer = { depth: 0, postId: null };
const listeners = new Set<() => void>();
let cached: SimulatorLayer = CLOSED;

function read(): SimulatorLayer {
  const raw = window.history.state?.[KEY] as SimulatorLayer | undefined;
  const depth = typeof raw?.depth === "number" ? raw.depth : 0;
  const postId = depth >= 2 && typeof raw?.postId === "string" ? raw.postId : null;
  // useSyncExternalStore needs a stable object while nothing changed.
  if (cached.depth !== depth || cached.postId !== postId) cached = { depth, postId };
  return cached;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function push(layer: SimulatorLayer) {
  // Keep the app's current screen on the entry, so Back lands on the same tab.
  window.history.pushState({ ...currentHistoryEntry(), [KEY]: layer }, "");
  listeners.forEach((l) => l());
}

function open() {
  if (read().depth === 0) push({ depth: 1, postId: null });
}

function openPost(postId: string) {
  if (read().depth === 1) push({ depth: 2, postId });
}

function back() {
  if (read().depth > 0) window.history.back();
}

export function useSimulatorLayer() {
  const layer = useSyncExternalStore(subscribe, read, () => CLOSED);
  return { ...layer, open, openPost, back };
}
