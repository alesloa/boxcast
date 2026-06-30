import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./os";
import { usePlayer } from "../store/player";

// Each modal that can pop out into its own OS window. The string is BOTH the
// window label (Rust side) and the URL hash the SPA reads to render that modal.
export type ModalKind = "settings";

/** The modal kind for the current document, from the URL hash (#settings). */
export function currentModalKind(): ModalKind | null {
  const h = (location.hash || "").replace(/^#/, "");
  return h === "settings" ? "settings" : null;
}

/**
 * Open (or focus) a pop-out modal window. Returns true if a real window was
 * opened (Tauri); false on the web build, where the caller should fall back to
 * the in-app overlay modal.
 */
export async function openModal(kind: ModalKind): Promise<boolean> {
  if (!isTauri()) return false;
  await invoke("open_modal_window", { kind });
  return true;
}

/** Close a pop-out modal window by kind (no-op on the web build). */
export async function closeModal(kind: ModalKind): Promise<void> {
  if (!isTauri()) return;
  await invoke("close_modal_window", { kind }).catch(() => {});
}

/** Gear handler: pop out the Settings window in Tauri; on web open the overlay. */
export async function openSettings(): Promise<void> {
  try {
    const opened = await openModal("settings");
    if (!opened) usePlayer.getState().setSettingsOpen(true);
  } catch {
    usePlayer.getState().setSettingsOpen(true);
  }
}
