import type { YoutubeItem, YoutubePlaylistInfo } from "../api/types";
import type { MenuItem } from "../components/ContextMenu";

// Public build: the downloader does not exist. Everything renders nothing.
export const DOWNLOADER_ENABLED = false;
export function RowControls(_p: { item: YoutubeItem }) { return null; }
export function SelectAllControl(_p: { items: YoutubeItem[] }) { return null; }
export function BulkBar() { return null; }
export function downloadMenuItems(_item: YoutubeItem): MenuItem[] { return []; }
export function QueuePanel() { return null; }
export function SettingsDownloadRow() { return null; }
export function DownloadAllPlaylists(_p: { playlists: YoutubePlaylistInfo[] }) { return null; }
export function PlaylistDownloadButton(_p: { playlist: YoutubePlaylistInfo }) { return null; }
export function GroupDownloadButton(_p: { name: string; items: { videoId: string; title: string }[] }) { return null; }
