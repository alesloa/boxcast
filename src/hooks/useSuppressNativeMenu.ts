import { useEffect } from "react";

/**
 * Kill the webview's built-in right-click menu (Reload / Inspect Element, and the
 * macOS text menu on inputs) everywhere, so the app's own menus are the only ones
 * that show. Text inputs get a custom Cut/Copy/Paste menu via GlobalContextMenu.
 */
export function useSuppressNativeMenu() {
  useEffect(() => {
    const onCtx = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);
}
