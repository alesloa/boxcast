import { useEffect, type RefObject } from "react";
import { usePlayer } from "../store/player";

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
}

const VOL_STEP = 0.05;

// space=play/pause, ←/→=prev/next (skip), ↑/↓=volume, m=mute, f=fullscreen
export function useKeyboardShortcuts(videoRef: RefObject<HTMLVideoElement>) {
  const togglePlay = usePlayer((s) => s.togglePlay);
  const toggleMute = usePlayer((s) => s.toggleMute);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const { next, prev, volume, setVolume } = usePlayer.getState();
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          next();
          break;
        case "ArrowLeft":
          prev();
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume(Math.min(1, Math.round((volume + VOL_STEP) * 100) / 100));
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume(Math.max(0, Math.round((volume - VOL_STEP) * 100) / 100));
          break;
        case "m":
        case "M":
          toggleMute();
          break;
        case "f":
        case "F": {
          const el = videoRef.current?.parentElement ?? videoRef.current;
          if (!el) break;
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          else el.requestFullscreen().catch(() => {});
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, toggleMute, videoRef]);
}
