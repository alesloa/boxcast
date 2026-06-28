import { usePlayer } from "../store/player";
import { MoonIcon, SettingsIcon, SunIcon, TvIcon } from "../lib/icons";
import { Tooltip } from "./Tooltip";
import {
  LeftWindowControls,
  RightWindowControls,
  isMac,
} from "./WindowControls";

export function TitleBar() {
  const setSettingsOpen = usePlayer((s) => s.setSettingsOpen);
  const theme = usePlayer((s) => s.theme);
  const toggleTheme = usePlayer((s) => s.toggleTheme);

  return (
    <div
      data-tauri-drag-region
      className="relative flex h-[42px] flex-none select-none items-center gap-[14px] border-b border-border px-[14px]"
      style={{ background: "var(--grad-titlebar)" }}
    >
      {isMac && <LeftWindowControls />}

      <div data-tauri-drag-region className="flex-1 self-stretch" />

      {/* brand, centered in the title bar */}
      <div
        data-tauri-drag-region
        className="pointer-events-none absolute left-1/2 top-0 flex h-full -translate-x-1/2 items-center gap-2 text-[13px] font-semibold tracking-[.2px] text-text"
      >
        <span className="text-green">
          <TvIcon size={16} />
        </span>
        BoxCast
      </div>

      <Tooltip label={theme === "dark" ? "Light theme" : "Dark theme"}>
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="grid h-[30px] w-[30px] place-items-center rounded-lg text-dim transition-colors hover:bg-hover hover:text-text"
        >
          {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        </button>
      </Tooltip>

      <Tooltip label="Settings">
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          className="grid h-[30px] w-[30px] place-items-center rounded-lg text-dim transition-colors hover:bg-hover hover:text-text"
        >
          <SettingsIcon size={16} />
        </button>
      </Tooltip>

      {!isMac && <RightWindowControls />}
    </div>
  );
}
