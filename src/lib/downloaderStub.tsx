import type { YoutubeItem } from "../api/types";
import type { MenuItem } from "../components/ContextMenu";

// Public build: the downloader does not exist. Everything renders nothing.
export const DOWNLOADER_ENABLED = false;
export function RowControls(_p: { item: YoutubeItem }) { return null; }
export function SelectAllControl(_p: { items: YoutubeItem[] }) { return null; }
export function BulkBar() { return null; }
export function downloadMenuItems(_item: YoutubeItem): MenuItem[] { return []; }
export function QueuePanel() { return null; }
export function SettingsDownloadRow() { return null; }
