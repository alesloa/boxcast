import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { usePlayer } from "./store/player";
import { useCatalog } from "./hooks/useCatalog";
import { useFavorites } from "./hooks/useFavorites";
import { filterChannels } from "./lib/filter";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useSuppressNativeMenu } from "./hooks/useSuppressNativeMenu";
import { useZoom } from "./hooks/useZoom";
import { api } from "./api/client";
import { isTauri } from "./lib/os";
import { applyAccent, clearAccent } from "./lib/accent";
import { saveTvFilters, saveTvCurrent } from "./lib/uiState";

import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { FilterChips } from "./components/FilterChips";
import { Player } from "./components/Player";
import { ChannelList } from "./components/ChannelList";
import { TransportBar } from "./components/TransportBar";
import { StatusBar } from "./components/StatusBar";
import { RadioMode } from "./components/RadioMode";
import { YouTubeMode } from "./components/YouTubeMode";
import { LibraryMode } from "./components/LibraryMode";
import { SettingsModal } from "./components/SettingsModal";
import { Toast } from "./components/Toast";
import { GlobalContextMenu } from "./components/GlobalContextMenu";

const SOURCE_LABEL: Record<string, string> = {
  tv: "iptv-org",
  radio: "radio-browser",
  youtube: "youtube",
  library: "local files",
};

export default function App() {
  const mode = usePlayer((s) => s.mode);
  const current = usePlayer((s) => s.current);
  const playChannel = usePlayer((s) => s.playChannel);
  const settingsOpen = usePlayer((s) => s.settingsOpen);
  const setSettingsOpen = usePlayer((s) => s.setSettingsOpen);
  const qc = useQueryClient();

  const theme = usePlayer((s) => s.theme);
  const accent = usePlayer((s) => s.accent);
  const subtitleColor = usePlayer((s) => s.subtitleColor);
  const search = usePlayer((s) => s.search);
  const categories = usePlayer((s) => s.categories);
  const countries = usePlayer((s) => s.countries);
  const languages = usePlayer((s) => s.languages);
  const hdOnly = usePlayer((s) => s.hdOnly);
  const favoritesOnly = usePlayer((s) => s.favoritesOnly);
  const setVolume = usePlayer((s) => s.setVolume);
  const setTransport = usePlayer((s) => s.setTransport);
  const setRadioCount = usePlayer((s) => s.setRadioCount);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  useKeyboardShortcuts(videoRef);
  useSuppressNativeMenu();
  useZoom();

  // Auto-advance over dead streams, but stop after a run of failures so an
  // all-dead slice of the list can't churn through thousands of channels.
  const deadCount = useRef(0);
  const autoAdvancing = useRef(false);
  const MAX_DEAD = 12;

  const { data: catalog } = useCatalog();
  const fav = useFavorites("tv");

  // Prefetch the default radio list at startup so the sidebar/status show the
  // station count immediately, before the user ever opens Radio. Same query key
  // RadioMode uses, so it shares this cache.
  const radioList = useQuery({
    queryKey: ["radio", ""],
    queryFn: () => api.radioSearch({ limit: 100 }),
    enabled: isTauri(),
    staleTime: 5 * 60 * 1000,
  });
  useEffect(() => {
    if (radioList.data) setRadioCount(radioList.data.length);
  }, [radioList.data, setRadioCount]);

  const channels = catalog?.channels ?? [];
  const facets = catalog?.facets;

  const filtered = useMemo(
    () =>
      filterChannels(channels, {
        search,
        categories,
        countries,
        languages,
        hdOnly,
        favoritesOnly,
        favorites: fav.refs,
      }),
    [channels, search, categories, countries, languages, hdOnly, favoritesOnly, fav.refs]
  );

  const playAt = (offset: number) => {
    if (!current || filtered.length === 0) {
      if (filtered.length) playChannel(filtered[0]);
      return;
    }
    const i = filtered.findIndex((c) => c.id === current.id);
    const base = i === -1 ? 0 : i;
    const next = filtered[(base + offset + filtered.length) % filtered.length];
    if (next) playChannel(next);
  };

  // Called by the player when the current stream is dead.
  const onUnavailable = () => {
    deadCount.current += 1;
    if (deadCount.current > MAX_DEAD) return; // give up the chain
    autoAdvancing.current = true;
    playAt(1);
  };

  // A manual channel pick resets the dead-stream chain; an auto-advance does not.
  useEffect(() => {
    if (autoAdvancing.current) autoAdvancing.current = false;
    else deadCount.current = 0;
  }, [current?.id]);

  // register channel prev/next as the global transport handlers in TV mode.
  // Radio and YouTube register their own over their visible lists.
  useEffect(() => {
    if (mode === "tv") setTransport(() => playAt(1), () => playAt(-1));
  }); // re-register every render so the closure sees the latest filtered list

  // persist Live TV browsing state (filters + the channel you were on) so it
  // restores across restarts; in-session it already lives in the store.
  useEffect(() => {
    saveTvFilters({ search, categories, countries, languages, hdOnly, favoritesOnly });
  }, [search, categories, countries, languages, hdOnly, favoritesOnly]);

  useEffect(() => {
    saveTvCurrent(current);
  }, [current]);

  // reflect the chosen theme on the root element (drives the CSS variables)
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // apply the chosen accent color (overrides the green CSS vars at runtime);
  // a null accent clears the overrides so the theme's default accent applies
  useEffect(() => {
    if (accent) applyAccent(accent);
    else clearAccent();
  }, [accent]);

  // apply the chosen subtitle color to ::cue via a managed <style> (most robust
  // way to set ::cue color dynamically across webviews)
  useEffect(() => {
    const id = "mc-subtitle-style";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = `video::cue{color:${subtitleColor};}`;
  }, [subtitleColor]);

  // load default volume from settings on first run (if user never set one)
  useEffect(() => {
    if (!isTauri()) return;
    if (localStorage.getItem("mc.volume") != null) return;
    api.settingsGet().then((s) => setVolume(s.defaultVolume)).catch(() => {});
  }, [setVolume]);

  // The pop-out Settings window saves to the DB itself, but accent / audio
  // language / volume live only in THIS window's store — it pushes those back
  // over "settings:apply". Re-apply them and refetch the DB-backed settings.
  useEffect(() => {
    if (!isTauri()) return;
    let un: (() => void) | undefined;
    listen<{ accent?: string | null; audioLang?: string; volume?: number }>(
      "settings:apply",
      (e) => {
        const p = e.payload;
        const st = usePlayer.getState();
        if ("accent" in p) st.setAccent(p.accent ?? null);
        if (p.audioLang !== undefined) st.setPreferredAudioLang(p.audioLang);
        if (p.volume !== undefined) st.setVolume(p.volume);
        qc.invalidateQueries({ queryKey: ["settings"] });
        qc.invalidateQueries({ queryKey: ["catalog"] });
      }
    ).then((f) => (un = f));
    return () => un?.();
  }, [qc]);

  // record recently-played
  useEffect(() => {
    if (!current || !isTauri()) return;
    api
      .recentsAdd({ source: "tv", ref: current.id, name: current.name, logo: current.logo ?? null })
      .catch(() => {});
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-full w-full">
      <div className="flex h-full w-full flex-col overflow-hidden rounded-win border border-border-strong bg-bg">
        <TitleBar />

        <div className="flex min-h-0 flex-1">
          <Sidebar facets={facets} totalChannels={channels.length || null} favCount={fav.count} />

          {mode === "tv" && (
            <div className="flex min-w-0 flex-1 flex-col">
              <FilterChips facets={facets} />
              <div className="flex min-h-0 flex-1">
                <Player videoRef={videoRef} onUnavailable={onUnavailable} />
                <ChannelList
                  channels={filtered}
                  favorites={fav.refs}
                  onToggleFav={fav.toggleChannel}
                />
              </div>
            </div>
          )}

          {mode === "radio" && <RadioMode audioRef={audioRef} />}
          {mode === "youtube" && <YouTubeMode />}
          {mode === "library" && <LibraryMode audioRef={audioRef} />}
        </div>

        <TransportBar videoRef={videoRef} />
        <StatusBar source={SOURCE_LABEL[mode]} channelCount={filtered.length} />
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <Toast />
      <GlobalContextMenu />
    </div>
  );
}
