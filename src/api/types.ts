// Shared API shapes — mirrors the Rust command return types in src-tauri.
// Field names are camelCase on the wire (serde renames to camelCase).

export type Source = "tv" | "radio" | "youtube" | "library";

export interface Stream {
  url: string;
  quality: string | null;
  referrer: string | null;
  userAgent: string | null;
}

export interface Country {
  code: string;
  name: string;
  flag: string;
}

export interface Channel {
  id: string;
  name: string;
  logo: string | null;
  categories: string[];
  country: Country | null;
  languages: string[];
  isNsfw: boolean;
  streams: Stream[];
}

export interface FacetCount {
  name: string;
  count: number;
}
export interface CountryFacet {
  code: string;
  name: string;
  flag: string;
  count: number;
}

export interface Facets {
  categories: FacetCount[];
  countries: CountryFacet[];
  languages: FacetCount[];
}

export interface Catalog {
  channels: Channel[];
  facets: Facets;
}

export interface Station {
  id: string;
  name: string;
  favicon: string | null;
  url: string;
  codec: string | null;
  bitrate: number | null;
  country: string | null;
  countryCode: string | null;
  tags: string[];
}

export interface RadioFacets {
  tags: FacetCount[];
  countries: { code: string; name: string; count: number }[];
}

export interface YoutubeItem {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  publishedAt: string;
}

export interface YoutubeResults {
  items: YoutubeItem[];
  nextPageToken: string | null;
}

export interface YoutubePlaylistInfo {
  playlistId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
}

export interface YtHidden {
  videoId: string;
  playlistId: string; // "" = banned everywhere
  title: string;
  channelTitle: string;
  thumbnail: string;
  hiddenAt: number;
}

export interface YtHideInput {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
}

export interface Favorite {
  id: string;
  source: Source;
  ref: string;
  name: string;
  logo: string | null;
  metaJson: string | null;
  createdAt: number;
}

export interface FavoriteInput {
  source: Source;
  ref: string;
  name: string;
  logo?: string | null;
  metaJson?: string | null;
}

export interface Recent {
  id: string;
  source: Source;
  ref: string;
  name: string;
  logo: string | null;
  playedAt: number;
}

export interface RecentInput {
  source: Source;
  ref: string;
  name: string;
  logo?: string | null;
}

export interface Settings {
  youtubeApiKey: string | null;
  nsfw: boolean;
  defaultVolume: number;
}

export interface SettingsPatch {
  youtubeApiKey?: string | null;
  nsfw?: boolean;
  defaultVolume?: number;
}

export interface LibFolder {
  id: number;
  path: string;
  label: string;
  color: string;
  addedAt: number;
}

export interface Track {
  id: number;
  folderId: number;
  path: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: number | null;
  trackNo: number | null;
  durationSec: number;
  artPath: string | null;
  addedAt: number;
}

export interface ArtistCount {
  name: string;
  count: number;
}
export interface AlbumInfo {
  name: string;
  artist: string;
  count: number;
  artPath: string | null;
}
export interface GenreCount {
  name: string;
  count: number;
}
export interface Playlist {
  id: number;
  name: string;
  createdAt: number;
  count: number;
}
export interface ScanResult {
  added: number;
  removed: number;
  updated: number;
}

export type TrackView =
  | { view: "all" }
  | { view: "recent" }
  | { view: "group"; value: string }
  | { view: "artist"; value: string }
  | { view: "album"; value: string }
  | { view: "genre"; value: string }
  | { view: "playlist"; value: string };

export type BrowseView = { view: "browse"; kind: "artists" | "albums" | "genres" };
export type LibraryView = TrackView | BrowseView;

export interface Mp3Probe {
  isMp3: boolean;
  durationSec: number;
  sampleRate: number;
  frameCount: number;
}
