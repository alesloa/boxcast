import { detectOS } from "../lib/os";
import {
  windowClose,
  windowMinimize,
  windowToggleMaximize,
} from "../lib/window";

export const OS = detectOS();
export const isMac = OS === "mac";

// ── macOS traffic lights (left side) ───────────────────────────────────────
function Glyph({ d }: { d: string }) {
  return (
    <svg
      width="7"
      height="7"
      viewBox="0 0 12 12"
      className="opacity-0 transition-opacity duration-100 group-hover:opacity-100"
      stroke="rgba(0,0,0,.55)"
      strokeWidth="1.4"
      strokeLinecap="round"
      fill="none"
    >
      <path d={d} />
    </svg>
  );
}

export function MacTrafficLights() {
  return (
    <div className="group no-drag flex items-center gap-2">
      <button
        onClick={() => windowClose()}
        aria-label="Close"
        title="Close"
        className="grid h-3 w-3 place-items-center rounded-full bg-mac-red active:brightness-90"
      >
        <Glyph d="M3 3l6 6M9 3l-6 6" />
      </button>
      <button
        onClick={() => windowMinimize()}
        aria-label="Minimize"
        title="Minimize"
        className="grid h-3 w-3 place-items-center rounded-full bg-mac-yellow active:brightness-90"
      >
        <Glyph d="M3 6h6" />
      </button>
      <button
        onClick={() => windowToggleMaximize()}
        aria-label="Zoom"
        title="Zoom"
        className="grid h-3 w-3 place-items-center rounded-full bg-mac-green active:brightness-90"
      >
        <Glyph d="M3.5 3.5h5v5z M8.5 8.5h-5v-5z" />
      </button>
    </div>
  );
}

// ── Windows / Linux caption buttons (right side), a touch smaller than native ─
function CaptionButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        "no-drag grid h-[30px] w-[42px] place-items-center text-dim transition-colors " +
        (danger
          ? "hover:bg-win-close hover:text-white"
          : "hover:bg-hover hover:text-text")
      }
    >
      {children}
    </button>
  );
}

export function WindowsCaptionButtons() {
  return (
    <div className="flex items-center self-stretch">
      <CaptionButton onClick={() => windowMinimize()} label="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </CaptionButton>
      <CaptionButton onClick={() => windowToggleMaximize()} label="Maximize">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </CaptionButton>
      <CaptionButton onClick={() => windowClose()} label="Close" danger>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </CaptionButton>
    </div>
  );
}

export function LeftWindowControls() {
  return isMac ? <MacTrafficLights /> : null;
}

export function RightWindowControls() {
  return isMac ? null : <WindowsCaptionButtons />;
}
