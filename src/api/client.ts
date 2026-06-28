import { invoke } from "@tauri-apps/api/core";
import type {
  AlbumInfo,
  ArtistCount,
  Catalog,
  Favorite,
  FavoriteInput,
  GenreCount,
  LibFolder,
  Mp3Probe,
  Playlist,
  RadioFacets,
  Recent,
  RecentInput,
  ScanResult,
  Settings,
  SettingsPatch,
  Station,
  Track,
  TrackView,
  YoutubePlaylistInfo,
  YoutubeResults,
  YtHidden,
  YtHideInput,
} from "./types";

// Thin wrappers over the Rust Tauri commands. Every backend call goes through
// here so the command names live in exactly one place.
export const api = {
  proxyBase: () => invoke<string>("proxy_base"),

  getCatalog: (refresh = false) => invoke<Catalog>("get_catalog", { refresh }),

  radioSearch: (params: {
    q?: string;
    tag?: string;
    country?: string;
    limit?: number;
  }) => invoke<Station[]>("radio_search", { params }),
  radioFacets: () => invoke<RadioFacets>("radio_facets"),

  youtubeSearch: (q: string, pageToken?: string) =>
    invoke<YoutubeResults>("youtube_search", { q, pageToken: pageToken ?? null }),
  youtubePlaylist: (playlistId: string, pageToken?: string) =>
    invoke<YoutubeResults>("youtube_playlist", { playlistId, pageToken: pageToken ?? null }),
  youtubeVideo: (videoId: string) =>
    invoke<YoutubeResults>("youtube_video", { videoId }),
  youtubePlaylistInfo: (playlistId: string) =>
    invoke<YoutubePlaylistInfo>("youtube_playlist_info", { playlistId }),

  ytHide: (playlistId: string, v: YtHideInput) => invoke<void>("yt_hide", { playlistId, v }),
  ytBan: (v: YtHideInput) => invoke<void>("yt_ban", { v }),
  ytRestore: (playlistId: string, videoId: string) =>
    invoke<void>("yt_restore", { playlistId, videoId }),
  ytUnban: (videoId: string) => invoke<void>("yt_unban", { videoId }),
  ytHiddenForPlaylist: (playlistId: string) =>
    invoke<YtHidden[]>("yt_hidden_for_playlist", { playlistId }),
  ytBans: () => invoke<YtHidden[]>("yt_bans"),

  favoritesList: () => invoke<Favorite[]>("favorites_list"),
  favoritesAdd: (fav: FavoriteInput) => invoke<Favorite>("favorites_add", { fav }),
  favoritesRemove: (source: string, ref: string) =>
    invoke<void>("favorites_remove", { source, refId: ref }),

  recentsList: (limit = 30) => invoke<Recent[]>("recents_list", { limit }),
  recentsAdd: (rec: RecentInput) => invoke<void>("recents_add", { rec }),

  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSet: (patch: SettingsPatch) => invoke<void>("settings_set", { patch }),

  libraryFolders: () => invoke<LibFolder[]>("library_folders"),
  libraryAddFolder: (path: string) => invoke<LibFolder>("library_add_folder", { path }),
  libraryRemoveFolder: (id: number) => invoke<void>("library_remove_folder", { id }),
  libraryRescan: (folderId?: number) =>
    invoke<ScanResult>("library_rescan", { folderId: folderId ?? null }),
  libraryTracks: (q: TrackView) =>
    invoke<Track[]>("library_tracks", {
      view: q.view,
      value: "value" in q ? q.value : null,
    }),
  libraryArtists: () => invoke<ArtistCount[]>("library_artists"),
  libraryAlbums: () => invoke<AlbumInfo[]>("library_albums"),
  libraryGenres: () => invoke<GenreCount[]>("library_genres"),
  libraryPlaylists: () => invoke<Playlist[]>("library_playlists"),
  playlistCreate: (name: string) => invoke<Playlist>("playlist_create", { name }),
  playlistRename: (id: number, name: string) => invoke<void>("playlist_rename", { id, name }),
  playlistDelete: (id: number) => invoke<void>("playlist_delete", { id }),
  playlistAdd: (playlistId: number, trackId: number) =>
    invoke<void>("playlist_add", { playlistId, trackId }),
  playlistRemove: (playlistId: number, trackId: number) =>
    invoke<void>("playlist_remove", { playlistId, trackId }),
  playlistReorder: (playlistId: number, trackIds: number[]) =>
    invoke<void>("playlist_reorder", { playlistId, trackIds }),

  mp3Probe: (path: string) => invoke<Mp3Probe>("mp3_probe", { path }),
  mp3Cut: (path: string, cuts: [number, number][], out: string) =>
    invoke<void>("mp3_cut", { path, cuts, out }),
  trackTrash: (id: number) => invoke<void>("track_trash", { id }),
};

// Build a proxied media URL for hls.js / <audio>.
export function proxiedUrl(
  base: string,
  url: string,
  referrer?: string | null,
  userAgent?: string | null
): string {
  let u = `${base}/proxy?url=${encodeURIComponent(url)}`;
  if (referrer) u += `&ref=${encodeURIComponent(referrer)}`;
  if (userAgent) u += `&ua=${encodeURIComponent(userAgent)}`;
  return u;
}
