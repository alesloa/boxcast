import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { usePlayer } from "../store/player";
import { api } from "../api/client";
import { isTauri } from "../lib/os";
import { ACCENT_PRESETS, DEFAULT_ACCENT } from "../lib/accent";
import { EyeIcon, EyeOffIcon } from "../lib/icons";
import { SettingsDownloadRow } from "@downloader";

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={
        "relative h-[22px] w-[40px] rounded-full transition-colors " +
        (on ? "bg-green" : "bg-border-strong")
      }
    >
      <span
        className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white transition-all"
        style={{ left: on ? 20 : 2 }}
      />
    </button>
  );
}

// State that lives only in the main window's store/localStorage (not the DB),
// pushed back to it over the "settings:apply" event when running as a pop-out.
export interface SettingsApply {
  accent?: string | null;
  audioLang?: string;
  volume?: number;
}

interface SettingsModalProps {
  /** Rendered as its own OS window (frameless, fills the window) vs in-app overlay. */
  inWindow?: boolean;
  /** Close handler: closes the window (pop-out) or hides the overlay (web). */
  onClose: () => void;
  /** Pop-out only: push live/save changes back to the main window. */
  onChanged?: (payload: SettingsApply) => void;
}

export function SettingsModal({ inWindow = false, onClose, onChanged }: SettingsModalProps) {
  const setVolume = usePlayer((s) => s.setVolume);
  const preferredAudioLang = usePlayer((s) => s.preferredAudioLang);
  const setPreferredAudioLang = usePlayer((s) => s.setPreferredAudioLang);
  const accent = usePlayer((s) => s.accent);
  const setAccent = usePlayer((s) => s.setAccent);
  const currentAccent = accent ?? DEFAULT_ACCENT;
  const qc = useQueryClient();

  // Accent applies instantly. In-app that recolors live; as a pop-out window it
  // also tells the main window so its accent updates immediately too.
  const chooseAccent = (value: string | null) => {
    setAccent(value);
    if (inWindow) onChanged?.({ accent: value });
  };

  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.settingsGet(),
    enabled: isTauri(),
  });

  const { data: bans } = useQuery({
    queryKey: ["yt-bans"],
    queryFn: () => api.ytBans(),
    enabled: isTauri(),
    staleTime: Infinity,
  });
  const unban = async (videoId: string) => {
    await api.ytUnban(videoId);
    qc.invalidateQueries({ queryKey: ["yt-bans"] });
  };

  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [nsfw, setNsfw] = useState(false);
  const [vol, setVol] = useState(70);
  const [audioLang, setAudioLang] = useState(preferredAudioLang);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!data) return;
    setKey(data.youtubeApiKey ?? "");
    setNsfw(data.nsfw);
    setVol(Math.round(data.defaultVolume * 100));
  }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      await api.settingsSet({
        youtubeApiKey: key.trim() || null,
        nsfw,
        defaultVolume: vol / 100,
      });
      setVolume(vol / 100);
      setPreferredAudioLang(audioLang.trim());
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
      // Pop-out: hand the non-DB, main-window-only state back across the gap.
      if (inWindow)
        onChanged?.({ accent: accent ?? null, audioLang: audioLang.trim(), volume: vol / 100 });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const refreshCatalog = async () => {
    setRefreshing(true);
    try {
      await api.getCatalog(true);
      qc.invalidateQueries({ queryKey: ["catalog"] });
    } finally {
      setRefreshing(false);
    }
  };

  const card = (
    <div
      className={clsx(
        "flex flex-col overflow-hidden rounded-[12px] border border-border-strong bg-elev text-text",
        inWindow ? "h-screen w-screen" : "max-h-[88vh] w-[460px] shadow-[0_30px_80px_rgba(0,0,0,.6)]"
      )}
    >
      <div
        className="flex items-center justify-between border-b border-border px-5 py-[14px]"
        {...(inWindow ? { "data-tauri-drag-region": true } : {})}
      >
        <div className="text-[14px] font-semibold" {...(inWindow ? { "data-tauri-drag-region": true } : {})}>
          Settings
        </div>
        <button
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-hover hover:text-text"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-auto px-5 py-5">
          {/* youtube key */}
          <div>
            <div className="text-[12.5px] font-semibold">YouTube API key</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
              Stored locally for YouTube search. search.list costs 100 units — the default
              10,000/day quota is ~100 searches/day.
            </p>
            <div className="relative mt-2">
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                type={showKey ? "text" : "password"}
                placeholder="AIza…"
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-[8px] border border-border bg-bg py-2 pl-3 pr-10 text-[13px] text-text outline-none focus:border-green-bd"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                title={showKey ? "Hide API key" : "Show API key"}
                aria-label={showKey ? "Hide API key" : "Show API key"}
                className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-dim hover:bg-hover hover:text-text"
              >
                {showKey ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
          </div>

          <SettingsDownloadRow />

          {/* accent color */}
          <div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12.5px] font-semibold">Accent color</div>
                <p className="mt-1 text-[11.5px] text-faint">
                  Used across the app for highlights, buttons, and the active state.
                </p>
              </div>
              {accent && (
                <button onClick={() => chooseAccent(null)} className="text-[11.5px] text-dim hover:text-text">
                  Reset
                </button>
              )}
            </div>
            <div className="mt-3 flex items-center gap-[10px]">
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => chooseAccent(c)}
                  aria-label={`Accent ${c}`}
                  title={c}
                  className={clsx(
                    "h-[22px] w-[22px] rounded-full transition-transform hover:scale-110",
                    currentAccent.toLowerCase() === c.toLowerCase()
                      ? "ring-2 ring-text ring-offset-2 ring-offset-elev"
                      : ""
                  )}
                  style={{ background: c }}
                />
              ))}
              {/* free color picker — the swatch opens the OS color picker */}
              <label
                className="relative grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-full border border-border-strong"
                style={{ background: "conic-gradient(red, #ff0, lime, aqua, blue, magenta, red)" }}
                title="Pick any color"
              >
                <input
                  type="color"
                  value={currentAccent}
                  onChange={(e) => chooseAccent(e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
            </div>
          </div>

          {/* nsfw */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12.5px] font-semibold">Show NSFW channels</div>
              <p className="mt-1 text-[11.5px] text-faint">Include adult-flagged channels in Live TV.</p>
            </div>
            <Toggle on={nsfw} onChange={setNsfw} />
          </div>

          {/* default volume */}
          <div>
            <div className="flex items-center justify-between">
              <div className="text-[12.5px] font-semibold">Default volume</div>
              <div className="text-[12px] text-dim">{vol}%</div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={vol}
              onChange={(e) => setVol(Number(e.target.value))}
              className="mt-2 w-full accent-green"
            />
          </div>

          {/* preferred audio language */}
          <div>
            <div className="text-[12.5px] font-semibold">Preferred audio language</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
              When a channel offers more than one audio track, auto-pick this language. Use a name
              or code (e.g. English, en, spa). Leave blank for the stream's default.
            </p>
            <input
              value={audioLang}
              onChange={(e) => setAudioLang(e.target.value)}
              placeholder="English"
              spellCheck={false}
              autoComplete="off"
              className="mt-2 w-full rounded-[8px] border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none focus:border-green-bd"
            />
          </div>

          {/* refresh catalog */}
          <div className="flex items-center justify-between border-t border-border pt-4">
            <div>
              <div className="text-[12.5px] font-semibold">Channel catalog</div>
              <p className="mt-1 text-[11.5px] text-faint">Re-fetch channels from iptv-org now.</p>
            </div>
            <button
              onClick={refreshCatalog}
              disabled={refreshing}
              className="rounded-[8px] border border-border bg-bg px-3 py-2 text-[12.5px] text-text hover:bg-hover disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {/* banned youtube videos */}
          <div className="border-t border-border pt-4">
            <div className="text-[12.5px] font-semibold">
              Banned videos{bans?.length ? ` (${bans.length})` : ""}
            </div>
            <p className="mt-1 text-[11.5px] text-faint">
              Videos you banned never appear in any playlist or search.
            </p>
            {bans && bans.length > 0 ? (
              <div className="mt-2 max-h-[200px] overflow-auto rounded-[8px] border border-border">
                {bans.map((b) => (
                  <div
                    key={b.videoId}
                    className="flex items-center gap-[10px] border-b border-border px-[10px] py-[8px] last:border-b-0"
                  >
                    {b.thumbnail ? (
                      <img
                        src={b.thumbnail}
                        alt=""
                        loading="lazy"
                        className="h-[32px] w-[56px] flex-none rounded-[5px] object-cover"
                      />
                    ) : (
                      <div className="h-[32px] w-[56px] flex-none rounded-[5px] bg-bg" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-text">{b.title || b.videoId}</div>
                      <div className="truncate text-[10.5px] text-faint">{b.channelTitle}</div>
                    </div>
                    <button
                      onClick={() => unban(b.videoId)}
                      className="flex-none rounded-[7px] border border-border bg-bg px-3 py-[5px] text-[11.5px] text-dim hover:bg-hover hover:text-text"
                    >
                      Unban
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[11.5px] text-faint">Nothing banned.</p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-[14px]">
          <button
            onClick={onClose}
            className="rounded-[8px] px-4 py-2 text-[12.5px] text-dim hover:text-text"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-[8px] bg-green px-4 py-2 text-[12.5px] font-semibold text-[var(--c-on-accent)] hover:bg-[var(--c-green-h)] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
    </div>
  );

  // Pop-out window: the card IS the window. Web/overlay: dim backdrop behind it.
  if (inWindow) return card;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 backdrop-blur-sm"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{card}</div>
    </div>
  );
}
