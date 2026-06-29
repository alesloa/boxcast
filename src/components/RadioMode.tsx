import { useEffect, useRef, useState, type RefObject } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { api, proxiedUrl } from "../api/client";
import { isTauri } from "../lib/os";
import { usePlayer } from "../store/player";
import { useProxyBase } from "../hooks/useProxyBase";
import { useFavorites, favMeta } from "../hooks/useFavorites";
import { Logo } from "./Logo";
import { SearchIcon, StarIcon, PlayIcon } from "../lib/icons";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { loadRadioUi, saveRadioUi } from "../lib/uiState";
import type { Station } from "../api/types";

function Visualizer({ audioRef, active }: { audioRef: RefObject<HTMLAudioElement>; active: boolean }) {
  const barsRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode } | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const audio = audioRef.current;
    const host = barsRef.current;
    if (!audio || !host) return;

    const N = 28;
    const bars: HTMLSpanElement[] = [];
    host.innerHTML = "";
    for (let i = 0; i < N; i++) {
      const b = document.createElement("span");
      b.style.cssText =
        "flex:1;border-radius:3px;background:linear-gradient(180deg,var(--c-green),var(--c-green-d));height:6%;transition:height .08s linear";
      host.appendChild(b);
      bars.push(b);
    }

    try {
      if (!ctxRef.current) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AC();
        const src = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        src.connect(analyser);
        analyser.connect(ctx.destination);
        ctxRef.current = { ctx, analyser };
      }
      const { ctx, analyser } = ctxRef.current;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        analyser.getByteFrequencyData(data);
        for (let i = 0; i < N; i++) {
          const v = data[i % data.length] / 255;
          bars[i].style.height = `${Math.max(6, v * 100)}%`;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      // Web Audio unavailable / CORS — gentle idle animation while playing
      let t = 0;
      const loop = () => {
        t += 0.08;
        for (let i = 0; i < N; i++) {
          const h = active ? 20 + 60 * Math.abs(Math.sin(t + i * 0.5)) : 6;
          bars[i].style.height = `${h}%`;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    }

    return () => cancelAnimationFrame(rafRef.current);
  }, [audioRef, active]);

  return <div ref={barsRef} className="flex h-[120px] w-full items-end gap-[3px]" />;
}

export function RadioMode({ audioRef }: { audioRef: RefObject<HTMLAudioElement> }) {
  const proxyBase = useProxyBase();
  const playing = usePlayer((s) => s.playing);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setNowPlaying = usePlayer((s) => s.setNowPlaying);
  const setPlaying = usePlayer((s) => s.setPlaying);
  const setStats = usePlayer((s) => s.setStats);
  const setRadioCount = usePlayer((s) => s.setRadioCount);
  const setTransport = usePlayer((s) => s.setTransport);
  const radioTag = usePlayer((s) => s.radioTag);
  const radioCountry = usePlayer((s) => s.radioCountry);

  const fav = useFavorites("radio");
  const ru = useRef(loadRadioUi()).current;
  const [text, setText] = useState(ru.text);
  const [query, setQuery] = useState(ru.query);
  const [tab, setTab] = useState<"stations" | "favorites">(ru.tab);
  const [selectedId, setSelectedId] = useState<string | null>(ru.selectedId);
  const [selectedStation, setSelectedStation] = useState<Station | null>(ru.selectedStation);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);

  // persist this tab's browsing state so it restores on return / restart
  useEffect(() => {
    saveRadioUi({ text, query, tab, selectedId, selectedStation, tag: radioTag, country: radioCountry });
  }, [text, query, tab, selectedId, selectedStation, radioTag, radioCountry]);

  // Live-search like Live TV: radio search hits the network, so debounce typing
  // into the actual query (fire after a pause, not on every keystroke). Enter
  // still searches immediately via the form's onSubmit.
  useEffect(() => {
    const t = text.trim();
    if (t === query) return;
    const id = window.setTimeout(() => setQuery(t), 400);
    return () => window.clearTimeout(id);
  }, [text, query]);

  // Paginated station search: each page is 100 stations, accumulated across
  // "Load more". The query key includes the genre/country filters, so changing
  // a filter (or the search) starts a fresh page-0 fetch automatically.
  const { data, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["radio", query, radioTag, radioCountry],
    queryFn: ({ pageParam }) =>
      api.radioSearch({
        q: query || undefined,
        tag: radioTag || undefined,
        country: radioCountry || undefined,
        limit: 100,
        offset: pageParam,
      }),
    enabled: isTauri(),
    staleTime: 5 * 60 * 1000,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 100 ? allPages.length * 100 : undefined,
  });

  const stations = data?.pages.flat() ?? [];

  // Saved stations, reconstructed from each favorite's stored metadata so they
  // play without a fresh search.
  const favStations: Station[] = fav.items
    .map((f) => favMeta<Station>(f))
    .filter((s): s is Station => !!s && !!s.url);

  // Selected can come from search results or from the favorites list.
  const selected =
    stations.find((s) => s.id === selectedId) ??
    (selectedStation && selectedStation.id === selectedId ? selectedStation : null);

  const railStations = tab === "favorites" ? favStations : stations;

  // Facet counts (shared cached query) give the true size of the active filter,
  // so the rail header shows that total directly — matching the sidebar —
  // instead of the lazily-loaded count. Genre/country are mutually exclusive,
  // so at most one is active at a time.
  const facets = useQuery({
    queryKey: ["radio-facets"],
    queryFn: () => api.radioFacets(),
    enabled: isTauri(),
    staleTime: Infinity,
  });
  const filterTotal: number | null = radioTag
    ? facets.data?.tags.find((t) => t.name === radioTag)?.count ?? null
    : radioCountry
      ? facets.data?.countries.find((c) => c.name === radioCountry)?.count ?? null
      : query
        ? null // free-text search has no precomputed total
        : facets.data?.total ?? null; // unfiltered = the whole directory
  const headerCount = filterTotal ?? stations.length;

  // Keep the sidebar/status station count in sync. Don't reset on unmount —
  // the count should persist when you leave Radio.
  useEffect(() => {
    setRadioCount(headerCount);
  }, [headerCount, setRadioCount]);

  // Infinite scroll: when the "Load more" sentinel scrolls near the viewport,
  // fetch the next page automatically (the button stays a manual fallback).
  useEffect(() => {
    const el = loadMoreRef.current;
    const root = scrollRef.current;
    if (!el || !root || !hasNextPage) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
      },
      { root, rootMargin: "300px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, stations.length, tab]);

  const playStation = (st: Station) => {
    setSelectedId(st.id);
    setSelectedStation(st);
    setPlaying(true);
    setNowPlaying({
      source: "radio",
      name: st.name,
      logo: st.favicon,
      sub: st.tags.slice(0, 2).join(", ") || st.country,
      live: false,
      quality: st.codec ? st.codec.toUpperCase() : null,
    });
    setStats({
      quality: st.codec ? st.codec.toUpperCase() : null,
      bitrateKbps: st.bitrate,
      protocol: st.codec ?? "—",
      bufferSec: null,
    });
  };

  // register transport (prev/next over the visible station list)
  useEffect(() => {
    const list = railStations;
    const idx = list.findIndex((s) => s.id === selectedId);
    setTransport(
      () => {
        if (!list.length) return;
        playStation(list[(idx + 1 + list.length) % list.length]);
      },
      () => {
        if (!list.length) return;
        playStation(list[(idx - 1 + list.length) % list.length]);
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railStations, selectedId]);

  // point the audio element at the selected station, but don't auto-play or
  // buffer — the play/pause sync effect below starts it only when `playing` is
  // true, so a restored-but-paused station opens zero network until you play.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !selected || !proxyBase) return;
    audio.crossOrigin = "anonymous";
    audio.preload = "none";
    audio.src = proxiedUrl(proxyBase, selected.url);
  }, [audioRef, selected?.id, proxyBase]); // eslint-disable-line react-hooks/exhaustive-deps

  // on restore, reflect the station in the bottom transport bar — paused.
  const restoredRef = useRef(ru.selectedStation != null);
  useEffect(() => {
    if (!restoredRef.current || !selectedStation) return;
    restoredRef.current = false;
    const st = selectedStation;
    setNowPlaying({
      source: "radio",
      name: st.name,
      logo: st.favicon,
      sub: st.tags.slice(0, 2).join(", ") || st.country,
      live: false,
      quality: st.codec ? st.codec.toUpperCase() : null,
    });
    setStats({
      quality: st.codec ? st.codec.toUpperCase() : null,
      bitrateKbps: st.bitrate,
      protocol: st.codec ?? "—",
      bufferSec: null,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // sync play/pause + volume
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = muted;
    audio.volume = volume;
    if (selected) {
      if (playing) audio.play().catch(() => {});
      else audio.pause();
    }
  }, [playing, volume, muted, selected?.id, audioRef]);

  // buffer stat poll
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const id = window.setInterval(() => {
      const b =
        audio.buffered.length > 0
          ? audio.buffered.end(audio.buffered.length - 1) - audio.currentTime
          : 0;
      setStats({ bufferSec: Math.max(0, b) });
    }, 1000);
    return () => window.clearInterval(id);
  }, [audioRef, setStats]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <audio ref={audioRef} className="hidden" />

      <div className="flex min-h-0 flex-1">
        {/* now playing / visualizer */}
        <div className="flex flex-1 flex-col gap-3 p-4" style={{ minWidth: 0 }}>
          <div
            className="flex flex-1 flex-col items-center justify-center gap-6 overflow-hidden rounded-[12px] border border-border-strong p-8"
            style={{
              background:
                "radial-gradient(120% 120% at 50% 0%, var(--c-green-bg), transparent 55%), linear-gradient(160deg,#15211a,#15181d)",
            }}
          >
            {selected ? (
              <>
                <Logo src={selected.favicon} name={selected.name} size={96} radius={20} />
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2">
                    <div className="text-[18px] font-[650]">{selected.name}</div>
                    <button
                      onClick={() => fav.toggle({ ref: selected.id, name: selected.name, logo: selected.favicon, meta: selected })}
                      title={fav.isFav(selected.id) ? "Remove from favorites" : "Save to favorites"}
                      className={clsx(
                        "grid h-7 w-7 place-items-center rounded-full transition-colors",
                        fav.isFav(selected.id) ? "text-yellow" : "text-faint hover:text-text"
                      )}
                      aria-label="Toggle favorite"
                    >
                      <StarIcon size={17} filled={fav.isFav(selected.id)} />
                    </button>
                  </div>
                  <div className="mt-1 text-[12.5px] text-dim">
                    {[selected.country, selected.codec?.toUpperCase(), selected.bitrate ? `${selected.bitrate} kbps` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="w-full max-w-[420px]">
                  <Visualizer audioRef={audioRef} active={playing} />
                </div>
              </>
            ) : (
              <div className="text-center text-dim">
                <div className="text-[15px] font-medium text-text">
                  {isFetching ? "Loading stations…" : "Pick a station"}
                </div>
                <div className="mt-1 text-[12.5px]">Browse the list to start listening</div>
              </div>
            )}
          </div>
        </div>

        {/* station rail */}
        <div className="flex w-[330px] flex-none flex-col border-l border-border">
          <div className="flex flex-col gap-[8px] border-b border-border px-[12px] pb-[10px] pt-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setTab("stations")}
                  className={clsx(
                    "rounded-[6px] px-2 py-1 text-[11px] font-bold tracking-[.6px] transition-colors",
                    tab === "stations" ? "bg-elev text-text" : "text-faint hover:text-dim"
                  )}
                >
                  STATIONS
                </button>
                <button
                  onClick={() => setTab("favorites")}
                  className={clsx(
                    "flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-bold tracking-[.6px] transition-colors",
                    tab === "favorites" ? "bg-elev text-text" : "text-faint hover:text-dim"
                  )}
                >
                  <StarIcon size={12} filled={tab === "favorites"} /> FAVORITES{fav.count ? ` (${fav.count})` : ""}
                </button>
              </div>
              {tab === "stations" && (
                <span className="text-[11px] font-medium text-faint">
                  {headerCount.toLocaleString("en-US")}
                </span>
              )}
            </div>
            {tab === "stations" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setQuery(text.trim());
                }}
                className="flex items-center gap-[8px] rounded-[8px] border border-border bg-elev px-[9px] py-[6px] text-dim focus-within:border-border-strong"
              >
                <SearchIcon size={14} />
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Filter stations…"
                  className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-faint"
                />
                {text && (
                  <button
                    type="button"
                    onClick={() => {
                      setText("");
                      setQuery("");
                    }}
                    aria-label="Clear filter"
                    className="text-[13px] leading-none text-faint hover:text-text"
                  >
                    ✕
                  </button>
                )}
              </form>
            )}
          </div>
          <div ref={scrollRef} className="flex-1 overflow-auto px-[10px] pb-[14px] pt-[6px]">
            {railStations.length === 0 ? (
              <div className="px-2 pt-10 text-center text-[12.5px] text-faint">
                {tab === "favorites"
                  ? "No saved stations yet. Tap the ★ to save one."
                  : isFetching
                    ? "Searching…"
                    : "No stations."}
              </div>
            ) : (
              <>
                {railStations.map((st) => (
                <div
                  key={st.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({
                      x: e.clientX,
                      y: e.clientY,
                      items: [
                        { icon: <PlayIcon size={12} />, label: "Play", onClick: () => playStation(st) },
                        {
                          icon: <StarIcon size={14} filled={fav.isFav(st.id)} />,
                          label: fav.isFav(st.id) ? "Remove from favorites" : "Add to favorites",
                          onClick: () => fav.toggle({ ref: st.id, name: st.name, logo: st.favicon, meta: st }),
                        },
                      ],
                    });
                  }}
                  className={clsx(
                    "group mb-1 flex w-full items-center gap-[11px] rounded-[9px] px-[10px] py-[9px]",
                    selectedId === st.id
                      ? "border border-green-bd bg-green-bg"
                      : "border border-transparent hover:bg-hover"
                  )}
                >
                  <button onClick={() => playStation(st)} className="flex min-w-0 flex-1 items-center gap-[11px] text-left">
                    <Logo src={st.favicon} name={st.name} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{st.name}</div>
                      <div className="mt-px truncate text-[11.5px] text-faint">
                        {[st.country, st.codec?.toUpperCase(), st.bitrate ? `${st.bitrate}k` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => fav.toggle({ ref: st.id, name: st.name, logo: st.favicon, meta: st })}
                    title={fav.isFav(st.id) ? "Remove from favorites" : "Save to favorites"}
                    className={clsx(
                      "grid h-7 w-7 flex-none place-items-center rounded-md transition-colors",
                      fav.isFav(st.id)
                        ? "text-yellow"
                        : "text-faint opacity-0 hover:text-text group-hover:opacity-100"
                    )}
                    aria-label="Toggle favorite"
                  >
                    <StarIcon size={15} filled={fav.isFav(st.id)} />
                  </button>
                </div>
                ))}
                {tab === "stations" && hasNextPage && (
                  <button
                    ref={loadMoreRef}
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="mb-1 mt-1 w-full rounded-[9px] border border-border bg-elev px-[10px] py-[9px] text-[12px] font-semibold text-dim transition-colors hover:bg-hover hover:text-text disabled:opacity-60"
                  >
                    {isFetchingNextPage ? "Loading…" : "Load more"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
