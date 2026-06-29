import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauri } from "../lib/os";

// Discrete, browser-style zoom ladder. 1.0 is the neutral (100%) step.
const STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
const NEUTRAL = STEPS.indexOf(1.0);
const KEY = "mc.zoom";

const apply = (factor: number) => {
  getCurrentWebview()
    .setZoom(factor)
    .catch(() => {});
};

// Snap a persisted factor back onto the nearest ladder step.
const nearestIndex = (factor: number) => {
  let best = NEUTRAL;
  let dist = Infinity;
  STEPS.forEach((s, i) => {
    const d = Math.abs(s - factor);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
};

/**
 * Mac-style page zoom: ⌘/Ctrl + "="/"+" zooms in, "-"/"_" out, "0" resets.
 * Uses the webview's native page zoom (like Safari/Chrome), so it scales the
 * whole UI — including the YouTube iframe — regardless of our fixed CSS layout
 * (the `zoomHotkeysEnabled` polyfill applies CSS `zoom` to <body>, which our
 * `overflow:hidden; height:100%` shell clips, so it does nothing here). The
 * level persists across launches.
 */
export function useZoom() {
  useEffect(() => {
    if (!isTauri()) return;
    let idx = nearestIndex(Number(localStorage.getItem(KEY)) || 1);
    apply(STEPS[idx]);

    const set = (next: number) => {
      idx = Math.max(0, Math.min(STEPS.length - 1, next));
      localStorage.setItem(KEY, String(STEPS[idx]));
      apply(STEPS[idx]);
    };

    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key;
      if (k === "=" || k === "+") {
        e.preventDefault();
        set(idx + 1);
      } else if (k === "-" || k === "_") {
        e.preventDefault();
        set(idx - 1);
      } else if (k === "0") {
        e.preventDefault();
        set(NEUTRAL);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
