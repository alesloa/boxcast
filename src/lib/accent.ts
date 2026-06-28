// Accent color. The whole app's accent is driven by the `--c-green*` CSS vars.
// When the user picks a custom accent we override those vars on the root element
// at runtime; inline styles win over the theme stylesheet, so a custom accent
// survives light/dark switches. With no custom accent set, the theme stylesheet
// drives the accent (the app's original green) — default behavior is unchanged.

const LS_ACCENT = "mc.accent";

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((c) => clamp(c).toString(16).padStart(2, "0")).join("");
}

// Multiply each channel — factor < 1 darkens, > 1 lightens.
function scale(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return toHex(r * factor, g * factor, b * factor);
}

// Blend toward white by `amount` (0..1) — yields a soft pastel tint.
function mixWhite(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

// Relative luminance (0..1), used to pick a readable foreground on the accent.
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isValidHex(hex: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex);
}

/** Override every accent CSS var on the root element from a single hex color. */
export function applyAccent(hex: string): void {
  if (!isValidHex(hex)) return;
  const [r, g, b] = hexToRgb(hex);
  const root = document.documentElement.style;
  root.setProperty("--c-green", hex);
  root.setProperty("--c-green-d", scale(hex, 0.72)); // gradient 2nd stop
  root.setProperty("--c-green-h", scale(hex, 1.12)); // hover
  root.setProperty("--c-green-bg", `rgba(${r}, ${g}, ${b}, 0.14)`);
  root.setProperty("--c-green-bd", `rgba(${r}, ${g}, ${b}, 0.4)`);
  root.setProperty("--c-green-text", mixWhite(hex, 0.55)); // soft tint for on-tint text
  root.setProperty("--c-on-accent", luminance(hex) > 0.55 ? "#0c1a0f" : "#ffffff");
}

/** Drop the overrides so the theme stylesheet drives the accent again. */
export function clearAccent(): void {
  const root = document.documentElement.style;
  [
    "--c-green",
    "--c-green-d",
    "--c-green-h",
    "--c-green-bg",
    "--c-green-bd",
    "--c-green-text",
    "--c-on-accent",
  ].forEach((v) => root.removeProperty(v));
}

export function getInitialAccent(): string | null {
  const v = localStorage.getItem(LS_ACCENT);
  return v && isValidHex(v) ? v : null;
}

export function persistAccent(hex: string | null): void {
  if (hex) localStorage.setItem(LS_ACCENT, hex);
  else localStorage.removeItem(LS_ACCENT);
}

/** The default accent swatch for the picker when none is set (the app's green). */
export const DEFAULT_ACCENT = "#3fb950";

/** Quick-pick presets shown next to the free color picker. */
export const ACCENT_PRESETS = [
  "#3fb950", // green (default)
  "#549bff", // blue
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#f0635c", // red
  "#e3b341", // amber
  "#06b6d4", // cyan
  "#ff7a45", // orange
];
