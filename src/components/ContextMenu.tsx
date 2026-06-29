import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

export type MenuItem = {
  icon?: React.ReactNode;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  separatorBefore?: boolean;
  submenu?: MenuItem[];
};

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [openSub, setOpenSub] = useState<number | null>(null);

  // Clamp into the viewport once measured.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + r.width > window.innerWidth) left = window.innerWidth - r.width - 8;
    if (top + r.height > window.innerHeight) top = window.innerHeight - r.height - 8;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const renderItems = (list: MenuItem[], sub = false) => (
    <div
      className={clsx(
        "min-w-[210px] rounded-[10px] border border-border-strong bg-elev p-1 shadow-[0_10px_30px_rgba(0,0,0,.5)]",
        sub && "absolute left-full top-0 -mt-1 ml-1"
      )}
    >
      {list.map((it, i) => (
        <div
          key={i}
          className="relative"
          onMouseEnter={() => !sub && setOpenSub(it.submenu ? i : null)}
        >
          {it.separatorBefore && <div className="my-1 h-px bg-border" />}
          <button
            disabled={it.disabled}
            title={it.disabled ? it.disabledHint : undefined}
            // keep focus on the underlying element (e.g. a text input) so the
            // clipboard actions in GlobalContextMenu still target it
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (it.disabled || it.submenu) return;
              it.onClick?.();
              onClose();
            }}
            className={clsx(
              "relative flex w-full items-center gap-[10px] rounded-[7px] px-[10px] py-[7px] text-left text-[12.5px] transition-colors",
              it.disabled
                ? "cursor-default text-faint"
                : it.danger
                  ? "text-red hover:bg-hover"
                  : "text-dim hover:bg-hover hover:text-text"
            )}
          >
            {it.icon && <span className="grid w-[16px] place-items-center">{it.icon}</span>}
            <span className="flex-1">{it.label}</span>
            {it.submenu && <span className="text-faint">›</span>}
          </button>
          {it.submenu && openSub === i && renderItems(it.submenu, true)}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div ref={ref} className="fixed z-[61]" style={{ left: pos.left, top: pos.top }}>
        {renderItems(items)}
      </div>
    </>
  );
}
