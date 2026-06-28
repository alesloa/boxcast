import { useState } from "react";
import clsx from "clsx";
import { usePlayer } from "../store/player";
import { CcIcon } from "../lib/icons";
import { Tooltip } from "./Tooltip";

const COLORS = [
  { name: "White", value: "#ffffff" },
  { name: "Yellow", value: "#ffe34d" },
  { name: "Green", value: "#6ee787" },
  { name: "Cyan", value: "#56d4dd" },
  { name: "Orange", value: "#ffa657" },
  { name: "Pink", value: "#ff8ad8" },
];

export function SubtitleMenu() {
  const tracks = usePlayer((s) => s.subtitleTracks);
  const active = usePlayer((s) => s.activeSubtitle);
  const color = usePlayer((s) => s.subtitleColor);
  const selectSubtitle = usePlayer((s) => s.selectSubtitle);
  const setSubtitlesEnabled = usePlayer((s) => s.setSubtitlesEnabled);
  const setSubtitleColor = usePlayer((s) => s.setSubtitleColor);

  const [open, setOpen] = useState(false);
  const on = active >= 0;

  const pickOff = () => {
    selectSubtitle(-1);
    setSubtitlesEnabled(false);
  };
  const pickTrack = (i: number) => {
    selectSubtitle(i);
    setSubtitlesEnabled(true);
  };

  return (
    <div className="relative">
      <Tooltip label="Subtitles" side="top">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Subtitles"
          className={clsx(
            "grid h-[34px] w-[34px] place-items-center rounded-[9px] transition-colors",
            on ? "bg-green-bg text-green" : "text-dim hover:bg-hover hover:text-text"
          )}
        >
          <CcIcon size={18} />
        </button>
      </Tooltip>

      {open && (
        <>
          {/* click-away backdrop */}
          <button
            className="fixed inset-0 z-[55] cursor-default"
            aria-label="Close subtitles menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full right-0 z-[60] mb-[10px] w-[230px] rounded-[10px] border border-border-strong bg-elev p-2 shadow-[0_10px_30px_rgba(0,0,0,.5)]">
            <div className="px-2 pb-1 pt-1 text-[10.5px] font-bold tracking-[.6px] text-faint">
              SUBTITLES
            </div>

            <button
              onClick={pickOff}
              className={clsx(
                "flex w-full items-center justify-between rounded-[7px] px-2 py-[7px] text-left text-[12.5px]",
                !on ? "bg-active text-text" : "text-dim hover:bg-hover hover:text-text"
              )}
            >
              Off {!on && <span className="text-green">✓</span>}
            </button>

            {tracks.length === 0 ? (
              <div className="px-2 py-[7px] text-[12px] text-faint">None in this stream</div>
            ) : (
              tracks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pickTrack(t.id)}
                  className={clsx(
                    "flex w-full items-center justify-between rounded-[7px] px-2 py-[7px] text-left text-[12.5px]",
                    active === t.id ? "bg-active text-text" : "text-dim hover:bg-hover hover:text-text"
                  )}
                >
                  <span className="truncate">{t.label}</span>
                  {active === t.id && <span className="text-green">✓</span>}
                </button>
              ))
            )}

            <div className="mt-1 border-t border-border px-2 pb-1 pt-2 text-[10.5px] font-bold tracking-[.6px] text-faint">
              COLOR
            </div>
            <div className="flex items-center gap-[7px] px-1 pb-1 pt-1">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setSubtitleColor(c.value)}
                  title={c.name}
                  aria-label={c.name}
                  className={clsx(
                    "h-5 w-5 rounded-full border transition-transform hover:scale-110",
                    color.toLowerCase() === c.value.toLowerCase()
                      ? "border-text ring-2 ring-green"
                      : "border-border-strong"
                  )}
                  style={{ background: c.value }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
