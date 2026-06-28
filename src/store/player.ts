import { create } from "zustand";
import type { Channel } from "../api/types";
import { applyAccent, clearAccent, getInitialAccent, persistAccent } from "../lib/accent";
import { loadTvFilters, loadTvCurrent, loadLibraryView, saveLibraryView } from "../lib/uiState";

export type Mode = "tv" | "radio" | "youtube" | "library";
export type Theme = "dark" | "light";

export interface PlayerStats {
  bitrateKbps: number | null;
  quality: string | null;
  bufferSec: number | null;
  protocol: string;
}

export interface SubtitleTrack {
  id: number;
  label: string;
}

export interface AudioTrack {
  id: number;
  label: string;
  lang: string;
}

export interface NowPlaying {
  source: Mode;
  name: string;
  logo: string | null;
  sub: string | null;
  live: boolean;
  quality: string | null;
}

const LS_VOL = "mc.volume";
const LS_MUTE = "mc.muted";
const LS_THEME = "mc.theme";
const LS_SUBS = "mc.subs";
const LS_SUBCOLOR = "mc.subColor";
const LS_AUDIOLANG = "mc.audioLang";
const LS_SHUFFLE = "mc.shuffle";
const LS_REPEAT = "mc.repeat";

function initialRepeat(): "off" | "all" | "one" {
  const v = localStorage.getItem(LS_REPEAT);
  return v === "all" || v === "one" ? v : "off";
}

function initialVolume(): number {
  const v = Number(localStorage.getItem(LS_VOL));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
}

function initialTheme(): Theme {
  return localStorage.getItem(LS_THEME) === "light" ? "light" : "dark";
}

interface PlayerState {
  mode: Mode;
  theme: Theme;
  accent: string | null;
  setAccent: (hex: string | null) => void;

  current: Channel | null;
  streamIndex: number;
  playing: boolean;

  nowPlaying: NowPlaying | null;
  next: () => void;
  prev: () => void;

  volume: number;
  muted: boolean;

  stats: PlayerStats;

  // current program / "now playing" title, when the stream advertises one
  programTitle: string | null;

  // subtitles
  subtitlesEnabled: boolean;
  subtitleColor: string;
  subtitleTracks: SubtitleTrack[];
  activeSubtitle: number; // -1 = off
  selectSubtitle: (i: number) => void; // registered by the player hook

  // audio tracks (multi-language streams)
  audioTracks: AudioTrack[];
  activeAudio: number;
  preferredAudioLang: string; // persisted; "" = use the stream's default
  selectAudio: (i: number) => void; // registered by the player hook

  radioCount: number | null;
  youtubeCount: number | null;

  // library
  libraryView: import("../api/types").LibraryView;
  setLibraryView: (v: import("../api/types").LibraryView) => void;

  queue: import("../api/types").Track[];
  queueIndex: number;
  setQueue: (tracks: import("../api/types").Track[], index: number) => void;

  shuffle: boolean;
  repeat: "off" | "all" | "one";
  toggleShuffle: () => void;
  cycleRepeat: () => void;

  position: number;
  duration: number;
  setPosition: (s: number) => void;
  setDuration: (s: number) => void;
  seek: (s: number) => void;
  setSeek: (fn: (s: number) => void) => void;

  search: string;
  categories: string[];
  countries: string[];
  languages: string[];
  hdOnly: boolean;
  favoritesOnly: boolean;

  settingsOpen: boolean;

  // transient undo toast (bottom-center pill)
  toast: { msg: string; onUndo: (() => void) | null } | null;
  showToast: (msg: string, onUndo?: (() => void) | null) => void;
  clearToast: () => void;

  setMode: (m: Mode) => void;
  toggleTheme: () => void;
  playChannel: (c: Channel) => void;
  setNowPlaying: (n: NowPlaying | null) => void;
  setTransport: (next: () => void, prev: () => void) => void;
  setPlaying: (p: boolean) => void;
  togglePlay: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setStreamIndex: (i: number) => void;
  setStats: (s: Partial<PlayerStats>) => void;
  resetStats: () => void;
  setProgramTitle: (t: string | null) => void;
  setSubtitlesEnabled: (b: boolean) => void;
  setSubtitleColor: (c: string) => void;
  setSubtitleTracks: (tracks: SubtitleTrack[], active: number) => void;
  setSelectSubtitle: (fn: (i: number) => void) => void;
  setAudioTracks: (tracks: AudioTrack[], active: number) => void;
  setSelectAudio: (fn: (i: number) => void) => void;
  setPreferredAudioLang: (lang: string) => void;
  setRadioCount: (n: number | null) => void;
  setYoutubeCount: (n: number | null) => void;

  setSearch: (s: string) => void;
  toggleCategory: (name: string) => void;
  toggleCountry: (code: string) => void;
  toggleLanguage: (name: string) => void;
  setHdOnly: (b: boolean) => void;
  setFavoritesOnly: (b: boolean) => void;
  clearFilters: () => void;

  setSettingsOpen: (b: boolean) => void;
}

const emptyStats: PlayerStats = {
  bitrateKbps: null,
  quality: null,
  bufferSec: null,
  protocol: "HLS",
};

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

// Single shared timer for the undo toast; re-showing resets it.
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const tvf = loadTvFilters();
const tvCurrent = loadTvCurrent();

export const usePlayer = create<PlayerState>((set, get) => ({
  mode: "tv",
  theme: initialTheme(),
  accent: getInitialAccent(),

  current: tvCurrent,
  streamIndex: 0,
  playing: false,

  nowPlaying: tvCurrent
    ? {
        source: "tv",
        name: tvCurrent.name,
        logo: tvCurrent.logo,
        sub: tvCurrent.categories[0] ?? null,
        live: true,
        quality: tvCurrent.streams.find((s) => s.quality)?.quality ?? null,
      }
    : null,
  next: () => {},
  prev: () => {},

  volume: initialVolume(),
  muted: localStorage.getItem(LS_MUTE) === "1",

  stats: emptyStats,

  programTitle: null,

  subtitlesEnabled: localStorage.getItem(LS_SUBS) === "1",
  subtitleColor: localStorage.getItem(LS_SUBCOLOR) || "#ffffff",
  subtitleTracks: [],
  activeSubtitle: -1,
  selectSubtitle: () => {},

  audioTracks: [],
  activeAudio: -1,
  preferredAudioLang: localStorage.getItem(LS_AUDIOLANG) || "",
  selectAudio: () => {},

  radioCount: null,
  youtubeCount: null,

  libraryView: loadLibraryView(),
  queue: [],
  queueIndex: -1,
  shuffle: localStorage.getItem(LS_SHUFFLE) === "1",
  repeat: initialRepeat(),
  position: 0,
  duration: 0,
  seek: () => {},

  search: tvf.search,
  categories: tvf.categories,
  countries: tvf.countries,
  languages: tvf.languages,
  hdOnly: tvf.hdOnly,
  favoritesOnly: tvf.favoritesOnly,

  settingsOpen: false,
  toast: null,

  setMode: (mode) => set({ mode, playing: false }),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === "dark" ? "light" : "dark";
      localStorage.setItem(LS_THEME, theme);
      return { theme };
    }),
  setAccent: (accent) => {
    persistAccent(accent);
    if (accent) applyAccent(accent);
    else clearAccent();
    set({ accent });
  },
  playChannel: (current) => {
    let quality: string | null = null;
    for (const s of current.streams) if (s.quality) { quality = s.quality; break; }
    set({
      current,
      streamIndex: 0,
      playing: true,
      stats: emptyStats,
      programTitle: null,
      nowPlaying: {
        source: "tv",
        name: current.name,
        logo: current.logo,
        sub: current.categories[0] ?? null,
        live: true,
        quality,
      },
    });
  },
  setNowPlaying: (nowPlaying) => set({ nowPlaying }),
  setTransport: (next, prev) => set({ next, prev }),
  setPlaying: (playing) => set({ playing }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setVolume: (volume) => {
    localStorage.setItem(LS_VOL, String(volume));
    set({ volume, muted: volume === 0 ? get().muted : false });
  },
  toggleMute: () =>
    set((s) => {
      const muted = !s.muted;
      localStorage.setItem(LS_MUTE, muted ? "1" : "0");
      return { muted };
    }),
  setStreamIndex: (streamIndex) => set({ streamIndex }),
  setStats: (s) => set((st) => ({ stats: { ...st.stats, ...s } })),
  resetStats: () => set({ stats: emptyStats }),
  setProgramTitle: (programTitle) => set({ programTitle }),
  setSubtitlesEnabled: (subtitlesEnabled) => {
    localStorage.setItem(LS_SUBS, subtitlesEnabled ? "1" : "0");
    set({ subtitlesEnabled });
  },
  setSubtitleColor: (subtitleColor) => {
    localStorage.setItem(LS_SUBCOLOR, subtitleColor);
    set({ subtitleColor });
  },
  setSubtitleTracks: (subtitleTracks, activeSubtitle) => set({ subtitleTracks, activeSubtitle }),
  setSelectSubtitle: (selectSubtitle) => set({ selectSubtitle }),
  setAudioTracks: (audioTracks, activeAudio) => set({ audioTracks, activeAudio }),
  setSelectAudio: (selectAudio) => set({ selectAudio }),
  setPreferredAudioLang: (preferredAudioLang) => {
    localStorage.setItem(LS_AUDIOLANG, preferredAudioLang);
    set({ preferredAudioLang });
  },
  setRadioCount: (radioCount) => set({ radioCount }),
  setYoutubeCount: (youtubeCount) => set({ youtubeCount }),

  setLibraryView: (libraryView) => {
    saveLibraryView(libraryView);
    set({ libraryView });
  },
  setQueue: (queue, queueIndex) => set({ queue, queueIndex }),
  toggleShuffle: () =>
    set((s) => {
      const shuffle = !s.shuffle;
      localStorage.setItem(LS_SHUFFLE, shuffle ? "1" : "0");
      return { shuffle };
    }),
  cycleRepeat: () =>
    set((s) => {
      const order = { off: "all", all: "one", one: "off" } as const;
      const repeat = order[s.repeat];
      localStorage.setItem(LS_REPEAT, repeat);
      return { repeat };
    }),
  setPosition: (position) => set({ position }),
  setDuration: (duration) => set({ duration }),
  setSeek: (seek) => set({ seek }),

  setSearch: (search) => set({ search }),
  toggleCategory: (name) => set((s) => ({ categories: toggle(s.categories, name) })),
  toggleCountry: (code) => set((s) => ({ countries: toggle(s.countries, code) })),
  toggleLanguage: (name) => set((s) => ({ languages: toggle(s.languages, name) })),
  setHdOnly: (hdOnly) => set({ hdOnly }),
  setFavoritesOnly: (favoritesOnly) => set({ favoritesOnly }),
  clearFilters: () =>
    set({
      categories: [],
      countries: [],
      languages: [],
      hdOnly: false,
      favoritesOnly: false,
      search: "",
    }),

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  showToast: (msg, onUndo = null) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { msg, onUndo } });
    toastTimer = setTimeout(() => set({ toast: null }), 6000);
  },
  clearToast: () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    set({ toast: null });
  },
}));
