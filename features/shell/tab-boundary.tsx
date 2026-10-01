"use client";

import { Component, type ReactNode } from "react";
import { ErrorState } from "@/components/common/error-state";

const RELOAD_KEY = "spaChunkReloadAt";

/**
 * After a new deploy, a tab opened for the first time can ask for a code chunk the
 * server no longer has. Reloading once picks up the new build; the timestamp guard
 * stops a reload loop if the failure is something else.
 */
function isChunkLoadError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  return (
    e?.name === "ChunkLoadError" ||
    /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      e?.message ?? "",
    )
  );
}

function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

interface State {
  error: unknown;
}

/** Keeps one tab's crash inside that tab; the rest of the app keeps working. */
export class TabBoundary extends Component<{ label: string; children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown) {
    if (isChunkLoadError(error) && reloadOnce()) return;
    console.error(`[app] ${this.props.label} tab crashed:`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-3 sm:p-6">
          <ErrorState
            title={`${this.props.label} couldn't load`}
            message={
              isChunkLoadError(this.state.error)
                ? "The app was updated. Reload the page to get the new version."
                : "Something went wrong on this tab. Your other tabs still work."
            }
            onRetry={() => this.setState({ error: null })}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
