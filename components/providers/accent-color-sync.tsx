"use client";
import { useEffect } from "react";
import { useSettings } from "@/hooks/use-settings";
import { applyAccentColor } from "@/lib/theme/apply-accent-client";

/**
 * Reconciles the DB's accentColor (the source of truth) into the live DOM
 * and the localStorage mirror app/layout.tsx's boot script reads on the next
 * full page load. Covers: first login on a new browser/device (localStorage
 * empty, DB has a value), and a color changed on another device. Renders
 * nothing — mounted once in the authenticated app shell.
 */
export function AccentColorSync() {
  const { settings } = useSettings();
  useEffect(() => {
    if (settings) applyAccentColor(settings.accentColor);
  }, [settings]);
  return null;
}
