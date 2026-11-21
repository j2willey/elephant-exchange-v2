import { useEffect } from "react";
import type { Theme } from "./api.js";

/** The app's own look, which a Theme's parts replace. Kept in step with :root in styles.css. */
const APP = { color: "#b3202e", page: "#f6f4f1", surface: "#ffffff", ink: "#1d1d1f" };

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/** WCAG relative luminance and contrast ratio, the measure of whether text can be read on a color. */
function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Text to put on a color: white or the app's near-black, whichever reads better. */
export const inkOn = (background: string) => (contrast("#ffffff", background) >= contrast(APP.ink, background) ? "#ffffff" : APP.ink);

/**
 * The color itself if text in it can be read on `background` (WCAG AA, 4.5:1); otherwise it's taken step by
 * step towards black (on a light background) or white (on a dark one) until it can.
 */
export function readableOn(color: string, background: string) {
  const towards = luminance(background) > 0.18 ? [0, 0, 0] : [255, 255, 255];
  const from = channels(color);
  for (let step = 0; step <= 20; step++) {
    const mixed = toHex(from.map((c, i) => c + ((towards[i]! - c) * step) / 20));
    if (contrast(mixed, background) >= 4.5) return mixed;
  }
  return toHex(towards);
}

/** The CSS variables a Theme sets; parts left unset aren't set, so the app's own (from styles.css) show. */
export function themeVariables(theme: Theme): Record<string, string> {
  const color = theme.color ?? APP.color;
  const page = theme.page ?? APP.page;
  const vars: Record<string, string> = {};
  if (theme.color) {
    vars["--brand"] = theme.color;
    vars["--brand-ink"] = inkOn(theme.color);
    vars["--brand-text"] = readableOn(theme.color, APP.surface);
  }
  if (theme.page) {
    vars["--page"] = theme.page;
    vars["--page-ink"] = inkOn(theme.page);
  }
  if (theme.color || theme.page) vars["--page-heading"] = readableOn(color, page);
  // The address is ours (a server path with a version), so it's safe inside url("…").
  if (theme.backgroundUrl) {
    vars["--page-image"] = `url("${theme.backgroundUrl}")`;
    // Text right on the page sits on a pane of the page color, the color it's made readable against, not on the image.
    vars["--on-image"] = `color-mix(in srgb, ${page} 88%, transparent)`;
    vars["--on-image-pad"] = "2px 10px";
  }
  return vars;
}

/** Shows this Theme for as long as the screen using it is open, then puts the app's own look back. */
export function useTheme(theme: Theme | undefined) {
  const key = theme ? JSON.stringify(themeVariables(theme)) : "{}";
  useEffect(() => {
    const vars = JSON.parse(key) as Record<string, string>;
    const root = document.documentElement.style;
    for (const [name, value] of Object.entries(vars)) root.setProperty(name, value);
    return () => {
      for (const name of Object.keys(vars)) root.removeProperty(name);
    };
  }, [key]);
}

/** The Theme's logo, if it has one, named for its Organization. */
export function ThemeLogo({ theme, className = "theme-logo" }: { theme: Theme; className?: string }) {
  if (!theme.logoUrl) return null;
  return <img className={className} src={theme.logoUrl} alt={`${theme.organization?.name ?? "Event"} logo`} />;
}
