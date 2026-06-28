import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * Lightweight CSS-only hover tooltip. Wraps a single control and reveals a
 * styled label on hover/focus — no JS state, so it stays snappy. `side` picks
 * whether the label appears above (transport bar) or below (title bar).
 */
export function Tooltip({
  label,
  side = "bottom",
  children,
  className,
}: {
  label: string;
  side?: "top" | "bottom";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={clsx("group/tt relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={clsx(
          "pointer-events-none absolute left-1/2 z-[60] -translate-x-1/2 whitespace-nowrap rounded-[6px]",
          "border border-border-strong bg-elev px-[7px] py-[3px] text-[11px] font-medium text-text",
          "opacity-0 shadow-[0_6px_18px_rgba(0,0,0,.45)] transition-opacity duration-100",
          "group-hover/tt:opacity-100",
          side === "top" ? "bottom-full mb-[7px]" : "top-full mt-[7px]"
        )}
      >
        {label}
      </span>
    </span>
  );
}
