import { useRef, type RefObject } from "react";
import clsx from "clsx";
import { usePlayer } from "../store/player";
import { Logo } from "./Logo";
import { Tooltip } from "./Tooltip";
import { SubtitleMenu } from "./SubtitleMenu";
import { AudioMenu } from "./AudioMenu";
import {
  FullscreenIcon,
  NextIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  VolumeIcon,
  VolumeMuteIcon,
} from "../lib/icons";

function VolumeBar() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const barRef = useRef<HTMLDivElement>(null);
  const pct = muted ? 0 : Math.round(volume * 100);

  const setFromEvent = (clientX: number) => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setVolume(Number(ratio.toFixed(2)));
  };

  return (
    <div
      ref={barRef}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setFromEvent(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) setFromEvent(e.clientX);
      }}
      className="relative flex h-4 flex-1 cursor-pointer items-center"
    >
      <div className="relative h-1 w-full rounded-[3px] bg-track">
        <div className="absolute left-0 top-0 bottom-0 rounded-[3px] bg-green" style={{ width: `${pct}%` }} />
        <div
          className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.5)]"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function fmtTime(sec: number): string {
  if (!sec || sec < 0 || !Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function SeekBar() {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const setPosition = usePlayer((s) => s.setPosition);
  const barRef = useRef<HTMLDivElement>(null);
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  const seekFromEvent = (clientX: number) => {
    const el = barRef.current;
    if (!el || duration <= 0) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const t = ratio * duration;
    setPosition(t);
    seek(t);
  };

  return (
    <div className="flex flex-1 items-center gap-[10px]">
      <span className="w-[34px] text-center text-[11px] tabular-nums text-faint">{fmtTime(position)}</span>
      <div
        ref={barRef}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          seekFromEvent(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seekFromEvent(e.clientX);
        }}
        className="group relative flex h-4 flex-1 cursor-pointer items-center"
      >
        <div className="relative h-1 w-full rounded-[3px] bg-track">
          <div className="absolute left-0 top-0 bottom-0 rounded-[3px] bg-green" style={{ width: `${pct}%` }} />
          <div
            className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.5)]"
            style={{ left: `${pct}%` }}
          />
        </div>
      </div>
      <span className="w-[34px] text-center text-[11px] tabular-nums text-faint">{fmtTime(duration)}</span>
    </div>
  );
}

export function TransportBar({ videoRef }: { videoRef: RefObject<HTMLVideoElement> }) {
  const mode = usePlayer((s) => s.mode);
  const audioCount = usePlayer((s) => s.audioTracks.length);
  const nowPlaying = usePlayer((s) => s.nowPlaying);
  const playing = usePlayer((s) => s.playing);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const muted = usePlayer((s) => s.muted);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const onPrev = usePlayer((s) => s.prev);
  const onNext = usePlayer((s) => s.next);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const cycleRepeat = usePlayer((s) => s.cycleRepeat);
  const autoplay = usePlayer((s) => s.autoplay);
  const toggleAutoplay = usePlayer((s) => s.toggleAutoplay);

  const togglePip = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {
      /* not supported / no video */
    }
  };

  const toggleFullscreen = async () => {
    const v = videoRef.current;
    const el = v?.parentElement ?? v;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      data-tauri-drag-region
      className="flex h-[60px] flex-none items-center gap-4 border-t border-border px-[18px]"
      style={{ background: "var(--grad-transport)" }}
    >
      {/* now playing */}
      <div className="flex w-[260px] min-w-0 items-center gap-[11px]">
        {nowPlaying ? (
          <>
            <Logo src={nowPlaying.logo} name={nowPlaying.name} size={38} />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">{nowPlaying.name}</div>
              <div className="mt-[2px] flex items-center gap-[5px] text-[11px] font-semibold text-green">
                <span className="h-[6px] w-[6px] rounded-full bg-green shadow-[0_0_6px_var(--c-green)]" />
                {nowPlaying.live ? "LIVE" : nowPlaying.source === "library" ? "PLAYING" : "ON AIR"}
                {nowPlaying.quality ? ` · ${nowPlaying.quality}` : ""}
              </div>
            </div>
          </>
        ) : (
          <div className="text-[12.5px] text-faint">Nothing playing</div>
        )}
      </div>

      {/* transport */}
      <div className="mx-auto flex items-center gap-[6px]">
        <Tooltip label="Previous" side="top">
          <button
            onClick={onPrev}
            aria-label="Previous"
            className="grid h-[38px] w-[38px] place-items-center rounded-[10px] text-dim transition-colors hover:bg-hover hover:text-text"
          >
            <PrevIcon size={18} />
          </button>
        </Tooltip>
        <Tooltip label={playing ? "Pause" : "Play"} side="top">
          <button
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
            className="grid h-[44px] w-[44px] place-items-center rounded-[10px] bg-green text-[var(--c-on-accent)] shadow-[0_4px_14px_var(--c-green-bd)] transition-colors hover:bg-[var(--c-green-h)]"
          >
            {playing ? <PauseIcon size={20} /> : <PlayIcon size={22} />}
          </button>
        </Tooltip>
        <Tooltip label="Next" side="top">
          <button
            onClick={onNext}
            aria-label="Next"
            className="grid h-[38px] w-[38px] place-items-center rounded-[10px] text-dim transition-colors hover:bg-hover hover:text-text"
          >
            <NextIcon size={18} />
          </button>
        </Tooltip>
      </div>

      {mode === "library" && <SeekBar />}

      {/* right controls */}
      <div className="flex min-w-[260px] items-center justify-end gap-[14px]">
        <div className="flex w-[140px] items-center gap-[9px] text-dim">
          <Tooltip label={muted ? "Unmute" : "Mute"} side="top">
            <button onClick={toggleMute} aria-label="Mute" className="hover:text-text">
              {muted ? <VolumeMuteIcon size={17} /> : <VolumeIcon size={17} />}
            </button>
          </Tooltip>
          <VolumeBar />
        </div>
        {/* Autoplay — YouTube's master "play next when one ends" switch. Kept as a
            labeled toggle (everyone else here is an icon). */}
        {mode === "youtube" && (
          <Tooltip label={autoplay ? "Autoplay on" : "Autoplay off"} side="top">
            <button
              onClick={toggleAutoplay}
              role="switch"
              aria-checked={autoplay}
              className="flex flex-none items-center gap-[7px] rounded-[9px] px-[8px] py-[5px] transition-colors hover:bg-hover"
            >
              <span className={clsx("text-[11px] font-semibold", autoplay ? "text-green" : "text-dim")}>
                Autoplay
              </span>
              <span
                className={clsx(
                  "relative h-[16px] w-[28px] flex-none rounded-full transition-colors",
                  autoplay ? "bg-green" : "bg-border-strong"
                )}
              >
                <span
                  className="absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white transition-all"
                  style={{ left: autoplay ? 14 : 2 }}
                />
              </span>
            </button>
          </Tooltip>
        )}
        {(mode === "library" || mode === "youtube") && (
          <>
            <Tooltip label="Shuffle" side="top">
              <button
                onClick={toggleShuffle}
                aria-label="Shuffle"
                className={clsx(
                  "grid h-[34px] w-[34px] place-items-center rounded-[9px] transition-colors hover:bg-hover",
                  shuffle ? "text-green" : "text-dim hover:text-text"
                )}
              >
                <ShuffleIcon size={16} />
              </button>
            </Tooltip>
            <Tooltip label={repeat === "one" ? "Repeat one" : repeat === "all" ? "Repeat all" : "Repeat off"} side="top">
              <button
                onClick={cycleRepeat}
                aria-label="Repeat"
                className={clsx(
                  "grid h-[34px] w-[34px] place-items-center rounded-[9px] transition-colors hover:bg-hover",
                  repeat !== "off" ? "text-green" : "text-dim hover:text-text"
                )}
              >
                {repeat === "one" ? <RepeatOneIcon size={16} /> : <RepeatIcon size={16} />}
              </button>
            </Tooltip>
          </>
        )}
        {mode === "tv" && audioCount > 1 && <AudioMenu />}
        {mode === "tv" && <SubtitleMenu />}
        {/* PiP and the app's fullscreen act on the TV <video>; YouTube and radio
            have no such element (YouTube uses its own fullscreen button). */}
        {mode === "tv" && (
          <>
            <Tooltip label="Picture in picture" side="top">
              <button
                onClick={togglePip}
                aria-label="Picture in picture"
                className={clsx(
                  "grid h-[34px] w-[34px] place-items-center rounded-[9px] text-dim transition-colors hover:bg-hover hover:text-text"
                )}
              >
                <PipIcon size={17} />
              </button>
            </Tooltip>
            <Tooltip label="Fullscreen" side="top">
              <button
                onClick={toggleFullscreen}
                aria-label="Fullscreen"
                className="grid h-[34px] w-[34px] place-items-center rounded-[9px] text-dim transition-colors hover:bg-hover hover:text-text"
              >
                <FullscreenIcon size={16} />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
