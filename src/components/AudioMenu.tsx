import { useState } from "react";
import clsx from "clsx";
import { usePlayer } from "../store/player";
import { LanguagesIcon } from "../lib/icons";
import { Tooltip } from "./Tooltip";

/**
 * Audio-language switcher. Only meaningful when a stream carries more than one
 * audio track; the parent hides it otherwise. Picking a track also remembers
 * the language so later channels auto-select it.
 */
export function AudioMenu() {
  const tracks = usePlayer((s) => s.audioTracks);
  const active = usePlayer((s) => s.activeAudio);
  const preferred = usePlayer((s) => s.preferredAudioLang);
  const selectAudio = usePlayer((s) => s.selectAudio);
  const setPreferredAudioLang = usePlayer((s) => s.setPreferredAudioLang);

  const [open, setOpen] = useState(false);

  const pick = (i: number) => {
    selectAudio(i);
    const t = tracks.find((x) => x.id === i);
    if (t) setPreferredAudioLang(t.lang || t.label);
  };

  return (
    <div className="relative">
      <Tooltip label="Audio language" side="top">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Audio language"
          className={clsx(
            "grid h-[34px] w-[34px] place-items-center rounded-[9px] transition-colors",
            preferred ? "bg-green-bg text-green" : "text-dim hover:bg-hover hover:text-text"
          )}
        >
          <LanguagesIcon size={18} />
        </button>
      </Tooltip>

      {open && (
        <>
          <button
            className="fixed inset-0 z-[55] cursor-default"
            aria-label="Close audio menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full right-0 z-[60] mb-[10px] w-[230px] rounded-[10px] border border-border-strong bg-elev p-2 shadow-[0_10px_30px_rgba(0,0,0,.5)]">
            <div className="px-2 pb-1 pt-1 text-[10.5px] font-bold tracking-[.6px] text-faint">
              AUDIO LANGUAGE
            </div>
            {tracks.map((t) => (
              <button
                key={t.id}
                onClick={() => pick(t.id)}
                className={clsx(
                  "flex w-full items-center justify-between rounded-[7px] px-2 py-[7px] text-left text-[12.5px]",
                  active === t.id ? "bg-active text-text" : "text-dim hover:bg-hover hover:text-text"
                )}
              >
                <span className="truncate">{t.label}</span>
                {active === t.id && <span className="text-green">✓</span>}
              </button>
            ))}
            <div className="px-2 pb-1 pt-2 text-[11px] leading-snug text-faint">
              Remembered for channels that offer this language.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
