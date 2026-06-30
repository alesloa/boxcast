import { useEffect } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePlayer } from "../store/player";
import { applyAccent, clearAccent } from "../lib/accent";
import { SettingsModal } from "../components/SettingsModal";
import type { ModalKind } from "../lib/modalWindow";

/**
 * Root of a pop-out modal window. It does NOT mount <App>, so it owns no player,
 * proxy, or catalog — just the one modal, loaded fresh from the backend. State
 * that lives only in the main window (accent, audio language, volume) is synced
 * back over a Tauri event the main window listens for ("settings:apply").
 */
export function ModalWindowHost({ kind }: { kind: ModalKind }) {
  const accent = usePlayer((s) => s.accent);

  // This window has its own DOM, so apply the saved accent here too — keeps its
  // own buttons/active states on-brand. Also flag <body> so CSS can strip the
  // page background to transparent (frameless, rounded window).
  useEffect(() => {
    if (accent) applyAccent(accent);
    else clearAccent();
    document.body.classList.add("modal-window");
    return () => document.body.classList.remove("modal-window");
  }, [accent]);

  const close = () => {
    getCurrentWindow()
      .close()
      .catch(() => {});
  };

  if (kind === "settings") {
    return (
      <SettingsModal
        inWindow
        onClose={close}
        onChanged={(payload) => {
          emit("settings:apply", payload);
        }}
      />
    );
  }
  return null;
}
