"use client";

import { useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { registerServiceWorker } from "@/lib/pwa/client";
import { openPath } from "@/features/shell/navigation";

/**
 * Registers the service worker once per page load and routes notification
 * clicks the worker couldn't navigate itself (a window it doesn't control yet).
 */
export function PwaProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    registerServiceWorker().catch((err) => console.warn("[pwa] service worker registration failed:", err));

    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type !== "navigate" || !data.url) return;
      const url = new URL(data.url, window.location.origin);
      if (url.origin !== window.location.origin) return;
      // Open the screen in place; if this page isn't the app (e.g. login), go there.
      if (window.location.pathname !== "/" || !openPath(url.pathname + url.search)) window.location.assign(url.href);
    };
    const onInstalled = () => toast.success("IG Monitor is installed. Open it from your home screen or app list.");
    navigator.serviceWorker.addEventListener("message", onMessage);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return <>{children}</>;
}
