import { useEffect } from "react";

/**
 * Kill the webview's built-in right-click menu (Reload / Inspect Element) everywhere,
 * so the app's own context menus are the only ones that show. Text inputs keep the
 * OS menu so copy/paste/spellcheck still work.
 */
export function useSuppressNativeMenu() {
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);
}
