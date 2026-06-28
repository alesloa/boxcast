// Per-tab UI state persisted to localStorage, so each tab (TV, Radio, YouTube,
// Library) restores its search / filters / list / selection across tab switches
// AND app restarts. Components seed their useState from these on mount and write
// back on change; TV's slice is read by the store. Ephemeral cursor state only —
// durable data (favorites, library, deletions) stays in SQLite.

import type { Channel, Station, YoutubeItem, LibraryView } from "../api/types";

function loadMerge<T extends object>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...(JSON.parse(v) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

function loadRaw<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / serialization — restore is best-effort */
  }
}

// ---- Radio ----
export interface RadioUi {
  text: string;
  query: string;
  tab: "stations" | "favorites";
  selectedId: string | null;
  selectedStation: Station | null;
}
const RADIO_DEFAULT: RadioUi = {
  text: "",
  query: "",
  tab: "stations",
  selectedId: null,
  selectedStation: null,
};
export const loadRadioUi = () => loadMerge("mc.ui.radio", RADIO_DEFAULT);
export const saveRadioUi = (v: RadioUi) => save("mc.ui.radio", v);

// ---- YouTube ----
export interface YoutubeUi {
  text: string;
  query: string;
  playlistId: string | null;
  directItems: YoutubeItem[];
  tab: "results" | "favorites";
  selected: YoutubeItem | null;
}
const YT_DEFAULT: YoutubeUi = {
  text: "",
  query: "",
  playlistId: null,
  directItems: [],
  tab: "results",
  selected: null,
};
export const loadYoutubeUi = () => loadMerge("mc.ui.youtube", YT_DEFAULT);
export const saveYoutubeUi = (v: YoutubeUi) => save("mc.ui.youtube", v);

// ---- Library cursor (the view is persisted separately, by the store) ----
export interface LibraryCursor {
  filter: string;
  selectedId: number | null;
}
const LIB_CURSOR_DEFAULT: LibraryCursor = { filter: "", selectedId: null };
export const loadLibraryCursor = () => loadMerge("mc.ui.library", LIB_CURSOR_DEFAULT);
export const saveLibraryCursor = (v: LibraryCursor) => save("mc.ui.library", v);

export const loadLibraryView = () => loadRaw<LibraryView>("mc.library.view", { view: "all" });
export const saveLibraryView = (v: LibraryView) => save("mc.library.view", v);

// ---- Live TV ----
export interface TvFilters {
  search: string;
  categories: string[];
  countries: string[];
  languages: string[];
  hdOnly: boolean;
  favoritesOnly: boolean;
}
const TV_FILTERS_DEFAULT: TvFilters = {
  search: "",
  categories: [],
  countries: [],
  languages: [],
  hdOnly: false,
  favoritesOnly: false,
};
export const loadTvFilters = () => loadMerge("mc.tv.filters", TV_FILTERS_DEFAULT);
export const saveTvFilters = (v: TvFilters) => save("mc.tv.filters", v);

export const loadTvCurrent = () => loadRaw<Channel | null>("mc.tv.current", null);
export const saveTvCurrent = (c: Channel | null) => save("mc.tv.current", c);
