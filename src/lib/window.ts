import { isTauri } from "./os";

// Safe wrappers around the Tauri window API. In a plain browser (Vite preview
// without the Tauri shell) these become no-ops so the UI still renders.
async function win() {
  if (!isTauri()) return null;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export async function windowMinimize() {
  (await win())?.minimize();
}
export async function windowToggleMaximize() {
  (await win())?.toggleMaximize();
}
export async function windowClose() {
  (await win())?.close();
}
export async function windowStartDragging() {
  (await win())?.startDragging();
}
export async function windowIsMaximized(): Promise<boolean> {
  const w = await win();
  return w ? w.isMaximized() : false;
}
export async function windowToggleFullscreen() {
  const w = await win();
  if (!w) return;
  const full = await w.isFullscreen();
  await w.setFullscreen(!full);
}
