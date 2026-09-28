import { converter, wcagContrast } from "culori";

/**
 * User-chosen accent color → CSS.
 *
 * **The exact color the user picks is used in light mode** — primary
 * buttons, links, the sidebar's active pill, focus rings, and heading text
 * are literally their hex, not a re-derived approximation. The one thing
 * computed is which foreground (near-white or near-black text) actually
 * reads on top of it, via WCAG contrast — a user could pick pale yellow or
 * navy, and guessing "white text" wouldn't hold up for both.
 *
 * Dark mode keeps the exact hue AND chroma but nudges lightness into a range
 * that stays visible on a dark surface (a user's exact navy/maroon pick would
 * otherwise nearly vanish into the dark background) — this is the one place
 * "shade of the color" rather than "the color" applies, and it's a legibility
 * necessity, not a design choice to water down their pick.
 *
 * Scope: primary buttons/links, focus rings, the sidebar's active nav pill,
 * heading text, and a colored glow shadow on primary buttons. Body text,
 * cards, and borders stay neutral — tinting those reads as a color cast over
 * the whole UI, not a color choice for it.
 */

export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const toOklch = converter("oklch");

interface Parsed {
  hex: string;
  l: number;
  c: number;
  h: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function parse(hex: string): Parsed | null {
  if (!HEX_COLOR_REGEX.test(hex)) return null;
  const c = toOklch(hex);
  // Achromatic (gray/black/white) has no meaningful hue to theme with — treat
  // as "no accent" rather than tint everything a meaningless gray-on-gray.
  if (!c || c.h === undefined || Number.isNaN(c.h) || c.c < 0.01) return null;
  return { hex, l: c.l, c: c.c, h: c.h };
}

/** Degrees, or null for an achromatic input — kept for callers that only need the hue. */
export function hueFromHex(hex: string): number | null {
  return parse(hex)?.h ?? null;
}

function oklchStr(l: number, c: number, h: number, alpha?: number): string {
  const base = `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(2)}`;
  return alpha === undefined ? `${base})` : `${base} / ${alpha})`;
}

/** Near-white or near-black — whichever actually contrasts against `color`. */
function bestForeground(color: string): string {
  const onWhite = wcagContrast(color, "#ffffff");
  const onBlack = wcagContrast(color, "#000000");
  return onWhite >= onBlack ? "oklch(0.98 0 0)" : "oklch(0.15 0 0)";
}

interface Recipe {
  primary: string;
  primaryForeground: string;
  ring: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarRing: string;
  accent: string;
  sidebarAccent: string;
  heading: string;
  shadow: string;
}

function recipe(p: Parsed, mode: "light" | "dark"): Recipe {
  if (mode === "light") {
    const primary = p.hex;
    const primaryForeground = bestForeground(primary);
    // Heading text needs to read directly on the page background (not a
    // solid primary-colored button), so it's darkened toward the hue rather
    // than reusing the button color verbatim — a light pick would otherwise
    // be nearly invisible as text on white.
    const heading = oklchStr(clamp(p.l, 0.3, 0.45), Math.max(p.c, 0.1), p.h);
    return {
      primary,
      primaryForeground,
      ring: primary,
      sidebarPrimary: primary,
      sidebarPrimaryForeground: primaryForeground,
      sidebarRing: primary,
      accent: oklchStr(0.96, Math.min(p.c, 0.03), p.h),
      sidebarAccent: oklchStr(0.96, Math.min(p.c, 0.03), p.h),
      heading,
      shadow: oklchStr(clamp(p.l, 0.45, 0.65), p.c, p.h, 0.35),
    };
  }

  // Dark mode: same hue + chroma as the user's exact pick, lightness only
  // moved into a range that survives a dark background.
  const primaryL = clamp(p.l, 0.55, 0.8);
  const primary = oklchStr(primaryL, p.c, p.h);
  const primaryForeground = bestForeground(primary);
  const heading = oklchStr(clamp(p.l, 0.72, 0.85), Math.max(p.c, 0.08), p.h);
  return {
    primary,
    primaryForeground,
    ring: primary,
    sidebarPrimary: primary,
    sidebarPrimaryForeground: primaryForeground,
    sidebarRing: primary,
    accent: oklchStr(0.27, Math.min(p.c, 0.045), p.h),
    sidebarAccent: oklchStr(0.27, Math.min(p.c, 0.045), p.h),
    heading,
    shadow: oklchStr(clamp(p.l, 0.55, 0.75), p.c, p.h, 0.45),
  };
}

function declarations(t: Recipe): string {
  return (
    `--primary:${t.primary};--primary-foreground:${t.primaryForeground};--ring:${t.ring};` +
    `--sidebar-primary:${t.sidebarPrimary};--sidebar-primary-foreground:${t.sidebarPrimaryForeground};` +
    `--sidebar-ring:${t.sidebarRing};--accent:${t.accent};--sidebar-accent:${t.sidebarAccent};` +
    `--heading:${t.heading};--shadow-accent:${t.shadow};`
  );
}

/** The `<style>` tag body for a user's accent color, or null for the default (no override). */
export function buildAccentCss(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const p = parse(hex);
  if (!p) return null;
  return `:root{${declarations(recipe(p, "light"))}}\n.dark{${declarations(recipe(p, "dark"))}}`;
}

export const ACCENT_STYLE_TAG_ID = "accent-theme";
/** localStorage key mirroring the computed CSS (not the raw hex) — see app/layout.tsx's boot script. */
export const ACCENT_STORAGE_KEY = "accentCss";
