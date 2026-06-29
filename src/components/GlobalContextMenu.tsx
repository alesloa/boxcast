import { useEffect, useState } from "react";
import { ContextMenu, type MenuItem } from "./ContextMenu";

type EditableField = HTMLInputElement | HTMLTextAreaElement;

/**
 * App-wide custom right-click menu for text fields (inputs, textareas,
 * contenteditable). The webview's native menu is suppressed everywhere by
 * useSuppressNativeMenu; this gives editable fields a native-feeling
 * Cut/Copy/Paste/Select All menu so right-click still works for things like
 * pasting a playlist URL — with none of the browser entries (Reload, Inspect…).
 *
 * Mount once, near the root (App). Non-editable targets are ignored here and
 * fall back to each component's own context menu (or nothing).
 */
export function GlobalContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      const isField = tag === "INPUT" || tag === "TEXTAREA";
      const isCE = t.isContentEditable;
      if (!isField && !isCE) return; // let component menus / the suppressor handle it

      e.preventDefault();
      const field = isField ? (t as EditableField) : null;
      field?.focus();

      const hasSelection = field
        ? field.selectionStart !== field.selectionEnd
        : !!window.getSelection()?.toString();
      const readOnly = field ? field.readOnly || field.disabled : false;

      const items: MenuItem[] = [
        {
          label: "Cut",
          disabled: !hasSelection || readOnly,
          onClick: () => document.execCommand("cut"),
        },
        {
          label: "Copy",
          disabled: !hasSelection,
          onClick: () => document.execCommand("copy"),
        },
        {
          label: "Paste",
          disabled: readOnly,
          onClick: async () => {
            try {
              const text = await navigator.clipboard.readText();
              document.execCommand("insertText", false, text);
            } catch {
              document.execCommand("paste"); // fallback if clipboard read is blocked
            }
          },
        },
        {
          label: "Select All",
          separatorBefore: true,
          onClick: () => {
            if (field) field.select();
            else document.execCommand("selectAll");
          },
        },
      ];
      setMenu({ x: e.clientX, y: e.clientY, items });
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);

  if (!menu) return null;
  return <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />;
}
