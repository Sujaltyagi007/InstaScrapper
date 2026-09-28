"use client";
import { buildAccentCss, ACCENT_STYLE_TAG_ID, ACCENT_STORAGE_KEY } from "./accent";

export function applyAccentColor(hex: string | null) {
  const css = buildAccentCss(hex);
  const existing = document.getElementById(ACCENT_STYLE_TAG_ID) as HTMLStyleElement | null;

  try {
    if (css) localStorage.setItem(ACCENT_STORAGE_KEY, css);
    else localStorage.removeItem(ACCENT_STORAGE_KEY);
  } catch { }

  if (!css) {
    existing?.remove();
    return;
  }
  const tag = existing ?? document.createElement("style");
  tag.id = ACCENT_STYLE_TAG_ID;
  tag.textContent = css;
  if (!existing) document.head.appendChild(tag);
}
