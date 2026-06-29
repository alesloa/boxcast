import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { AudioEditor } from "./AudioEditor";
import clsx from "clsx";
import { api } from "../api/client";
import { isTauri } from "../lib/os";
import { usePlayer } from "../store/player";
import { useFavorites } from "../hooks/useFavorites";
import { SearchIcon, StarIcon, PlayIcon, PauseIcon, FolderIcon, XIcon, PencilIcon, TrashIcon, FolderOpenIcon, PlusIcon, PlaylistIcon } from "../lib/icons";
import { loadLibraryCursor, saveLibraryCursor } from "../lib/uiState";
import type { Track, BrowseView } from "../api/types";

function fmtDur(sec: number): string {
  if (!sec || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function viewTitle(view: string, label: string | undefined): string {
  if (label) return label;
  return (
    { all: "All Songs", recent: "Recently Added" }[view] ?? view.charAt(0).toUpperCase() + view.slice(1)
  );
}

export function LibraryMode({ audioRef }: { audioRef: RefObject<HTMLAudioElement> }) {
  const enabled = isTauri();
  const qc = useQueryClient();
  const view = usePlayer((s) => s.libraryView);
  const setLibraryView = usePlayer((s) => s.setLibraryView);
  const playing = usePlayer((s) => s.playing);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const setPlaying = usePlayer((s) => s.setPlaying);
  const setNowPlaying = usePlayer((s) => s.setNowPlaying);
  const setStats = usePlayer((s) => s.setStats);
  const setTransport = usePlayer((s) => s.setTransport);
  const setQueue = usePlayer((s) => s.setQueue);
  const setPosition = usePlayer((s) => s.setPosition);
  const setDuration = usePlayer((s) => s.setDuration);
  const setSeek = usePlayer((s) => s.setSeek);

  const fav = useFavorites("library");
  const lc = useRef(loadLibraryCursor()).current;
  const [filter, setFilter] = useState(lc.filter);
  const [selectedId, setSelectedId] = useState<number | null>(lc.selectedId);
  // The track loaded in the <audio> element. Stable across view switches — set
  // only when the user plays something — so browsing views never reloads/resets
  // the song. (`selected` below is view-derived and flickers on refetch; it must
  // NOT drive playback.)
  const [playingTrack, setPlayingTrack] = useState<Track | null>(null);

  // persist the in-library search + selected track (the view is persisted by the store)
  useEffect(() => {
    saveLibraryCursor({ filter, selectedId });
  }, [filter, selectedId]);

  // folders, to label the current group view + power the empty state
  const folders = useQuery({ queryKey: ["lib", "folders"], queryFn: api.libraryFolders, enabled });

  const playlists = useQuery({ queryKey: ["lib", "playlists"], queryFn: api.libraryPlaylists, enabled });
  const [menu, setMenu] = useState<{ x: number; y: number; track: Track } | null>(null);
  const [editing, setEditing] = useState<Track | null>(null);
  const dragId = useRef<number | null>(null);
  const playingRowRef = useRef<HTMLDivElement>(null); // the now-playing row, for scroll-into-view
  const scrolledForRef = useRef<string | null>(null); // last view we already focused for
  const inPlaylist = view.view === "playlist";

  const browsing = view.view === "browse";

  const tracksQ = useQuery({
    queryKey: ["lib", "tracks", view],
    queryFn: () => api.libraryTracks(view as Exclude<typeof view, { view: "browse" }>),
    enabled: enabled && !browsing,
  });
  const tracks = useMemo(() => tracksQ.data ?? [], [tracksQ.data]);

  const groupLabel =
    view.view === "group"
      ? folders.data?.find((f) => String(f.id) === view.value)?.label
      : view.view === "artist" || view.view === "album" || view.view === "genre" || view.view === "playlist"
        ? view.value
        : undefined;

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
    );
  }, [tracks, filter]);

  const totalSec = useMemo(() => tracks.reduce((a, t) => a + t.durationSec, 0), [tracks]);

  const playTrack = (t: Track) => {
    setSelectedId(t.id);
    setPlayingTrack(t);
    setQueue(visible, visible.findIndex((x) => x.id === t.id));
    setPlaying(true);
    setNowPlaying({
      source: "library",
      name: t.title,
      logo: t.artPath ? convertFileSrc(t.artPath) : null,
      sub: [t.artist, t.album].filter(Boolean).join(" · "),
      live: false,
      quality: null,
    });
    setStats({ quality: null, bitrateKbps: null, protocol: "FILE", bufferSec: null });
  };

  const selected = visible.find((t) => t.id === selectedId) ?? tracks.find((t) => t.id === selectedId) ?? null;

  // point the audio element at the *playing* track (stable across view switches);
  // the play/pause sync effect below starts it only when `playing` is true, so a
  // restored track stays paused.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playingTrack) return;
    audio.src = convertFileSrc(playingTrack.path);
    audio.load();
  }, [audioRef, playingTrack?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // on restore, reflect the track in the bottom transport bar — paused.
  const restoredCursorRef = useRef(lc.selectedId != null);
  useEffect(() => {
    if (!restoredCursorRef.current || !selected) return;
    restoredCursorRef.current = false;
    setPlayingTrack(selected); // load it (paused) so the play button resumes it
    setNowPlaying({
      source: "library",
      name: selected.title,
      logo: selected.artPath ? convertFileSrc(selected.artPath) : null,
      sub: [selected.artist, selected.album].filter(Boolean).join(" · "),
      live: false,
      quality: null,
    });
    setStats({ quality: null, bitrateKbps: null, protocol: "FILE", bufferSec: null });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // sync play/pause + volume against the playing track
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = muted;
    audio.volume = volume;
    if (playingTrack) {
      if (playing) audio.play().catch(() => {});
      else audio.pause();
    }
  }, [playing, volume, muted, playingTrack?.id, audioRef]);

  // position/duration + register seek
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setPosition(audio.currentTime || 0);
    const onMeta = () => setDuration(audio.duration || 0);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    setSeek((s: number) => {
      audio.currentTime = s;
    });
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
    };
  }, [audioRef, setPosition, setDuration, setSeek]);

  // prev/next/auto-advance over the visible queue (honor shuffle + repeat)
  useEffect(() => {
    const list = visible;
    const idx = list.findIndex((t) => t.id === selectedId);
    const pick = (dir: 1 | -1) => {
      if (!list.length) return;
      if (shuffle) {
        if (list.length === 1) return playTrack(list[0]);
        let r = idx;
        while (r === idx) r = Math.floor(Math.random() * list.length);
        return playTrack(list[r]);
      }
      const ni = (idx + dir + list.length) % list.length;
      playTrack(list[ni]);
    };
    setTransport(() => pick(1), () => pick(-1));

    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (repeat === "one" && playingTrack) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
      }
      if (!list.length) return;
      if (!shuffle && repeat === "off" && idx === list.length - 1) {
        setPlaying(false);
        return;
      }
      pick(1);
    };
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selectedId, shuffle, repeat, playingTrack]);

  // When you navigate to a view that contains the now-playing track, scroll it
  // into focus (like Apple Music / Spotify). Only on view change — not on click
  // (already on screen) or auto-advance (don't yank the user's scroll).
  const viewKey = JSON.stringify(view);
  useEffect(() => {
    if (!playingTrack) {
      scrolledForRef.current = viewKey; // nothing playing → mark handled, no scroll
      return;
    }
    if (scrolledForRef.current === viewKey) return; // already focused this view
    const el = playingRowRef.current;
    if (!el) return; // row not rendered yet (data loading, or track not in this view)
    el.scrollIntoView({ block: "center" });
    scrolledForRef.current = viewKey;
  }, [viewKey, visible, playingTrack?.id]);

  // Follow the now-playing track when it changes (next/prev/auto-advance), like
  // Spotify — so you always see what's playing. No-op when the track isn't in
  // the current view (its row ref is unmounted).
  useEffect(() => {
    playingRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [playingTrack?.id]);

  const addFolder = async () => {
    const picked = await open({ directory: true, multiple: false, title: "Add music folder" });
    if (typeof picked !== "string") return;
    await api.libraryAddFolder(picked);
    qc.invalidateQueries({ queryKey: ["lib"] });
  };

  const rescan = async () => {
    const fid = view.view === "group" ? Number(view.value) : undefined;
    await api.libraryRescan(fid);
    qc.invalidateQueries({ queryKey: ["lib"] });
  };

  const hasFolders = (folders.data?.length ?? 0) > 0;

  const isMp3 = (t: Track) => t.path.toLowerCase().endsWith(".mp3");

  const trashTrack = async (t: Track) => {
    const ok = await confirm(`Move "${t.title}" to the Trash?`, { title: "Move to Trash", kind: "warning" });
    if (!ok) return;
    await api.trackTrash(t.id);
    qc.invalidateQueries({ queryKey: ["lib"] });
  };

  const menuItems = (t: Track): MenuItem[] => {
    const isCur = playingTrack?.id === t.id;
    const pls = playlists.data ?? [];
    const items: MenuItem[] = [
      {
        icon: isCur && playing ? <PauseIcon size={14} /> : <PlayIcon size={12} />,
        label: isCur && playing ? "Pause" : "Play",
        onClick: () => (isCur && playing ? setPlaying(false) : playTrack(t)),
      },
      {
        icon: <StarIcon size={14} filled={fav.isFav(t.path)} />,
        label: fav.isFav(t.path) ? "Remove from favorites" : "Add to favorites",
        onClick: () => fav.toggle({ ref: t.path, name: t.title, logo: t.artPath, meta: t }),
      },
      {
        icon: <PencilIcon size={14} />,
        label: "Edit…",
        disabled: !isMp3(t),
        disabledHint: "Lossless editing supports MP3 files only",
        onClick: () => setEditing(t),
      },
      {
        icon: <PlaylistIcon size={14} />,
        label: "Add to playlist",
        submenu: [
          ...pls.map((p) => ({
            label: p.name,
            onClick: async () => {
              await api.playlistAdd(p.id, t.id);
              qc.invalidateQueries({ queryKey: ["lib", "playlists"] });
            },
          })),
          {
            icon: <PlusIcon size={13} />,
            label: "New playlist…",
            separatorBefore: pls.length > 0,
            onClick: async () => {
              const name = window.prompt("New playlist name");
              if (!name?.trim()) return;
              const p = await api.playlistCreate(name.trim());
              await api.playlistAdd(p.id, t.id);
              qc.invalidateQueries({ queryKey: ["lib", "playlists"] });
            },
          },
        ],
      },
    ];
    if (view.view === "playlist") {
      items.push({
        icon: <XIcon size={13} />,
        label: "Remove from this playlist",
        onClick: async () => {
          await api.playlistRemove(Number(view.value), t.id);
          qc.invalidateQueries({ queryKey: ["lib", "tracks", view] });
        },
      });
    }
    items.push(
      {
        icon: <FolderOpenIcon size={14} />,
        label: "Reveal in Finder",
        separatorBefore: true,
        onClick: () => revealItemInDir(t.path).catch(() => {}),
      },
      {
        icon: <TrashIcon size={14} />,
        label: "Move to Trash",
        danger: true,
        onClick: () => trashTrack(t),
      }
    );
    return items;
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <audio ref={audioRef} className="hidden" />

      {/* header */}
      <div className="flex h-[54px] flex-none items-center gap-3 border-b border-border px-4">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-[650]">
            {browsing
              ? { artists: "Artists", albums: "Albums", genres: "Genres" }[(view as BrowseView).kind]
              : viewTitle(view.view, groupLabel)}
          </div>
          <div className="truncate text-[12.5px] text-dim">
            {browsing ? "Browse your library" : `${tracks.length} songs · ${fmtDur(totalSec)}`}
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-[9px] rounded-[9px] border border-border bg-elev px-3 py-2 text-dim focus-within:border-border-strong">
          <SearchIcon size={15} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="w-[180px] bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
          />
        </div>
        <button
          onClick={rescan}
          className="rounded-[8px] px-[11px] py-[7px] text-[12.5px] font-medium text-dim transition-colors hover:bg-hover hover:text-text"
        >
          ↻ Rescan
        </button>
        <button
          onClick={addFolder}
          className="flex items-center gap-[7px] rounded-[8px] bg-green px-[11px] py-[7px] text-[12.5px] font-semibold text-[var(--c-on-accent)] transition-colors hover:bg-[var(--c-green-h)]"
        >
          <FolderIcon size={15} /> Add folder
        </button>
      </div>

      {/* body */}
      {!hasFolders ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="text-[15px] font-medium text-text">No music yet</div>
          <div className="max-w-[320px] text-[12.5px] text-dim">
            Add a folder of audio files and BoxCast will build your library.
          </div>
          <button
            onClick={addFolder}
            className="mt-1 flex items-center gap-[7px] rounded-[8px] bg-green px-[14px] py-[8px] text-[13px] font-semibold text-[var(--c-on-accent)] hover:bg-[var(--c-green-h)]"
          >
            <FolderIcon size={15} /> Add folder
          </button>
        </div>
      ) : browsing ? (
        <BrowseList kind={(view as BrowseView).kind} onPick={setLibraryView} />
      ) : (
        <div className="flex-1 overflow-auto">
          {/* column header */}
          <div className="sticky top-0 z-[1] grid grid-cols-[38px_1fr_200px_120px_72px_64px] items-center gap-3 border-b border-border bg-bg px-[18px] py-2 text-[10.5px] font-bold tracking-[.6px] text-faint">
            <div className="text-center">#</div>
            <div>TITLE</div>
            <div>ALBUM</div>
            <div>GENRE</div>
            <div />
            <div className="text-right">TIME</div>
          </div>

          {visible.map((t, i) => {
            const isPlaying = selectedId === t.id;
            return (
              <div
                key={t.id}
                ref={t.id === playingTrack?.id ? playingRowRef : undefined}
                onDoubleClick={() => playTrack(t)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, track: t });
                }}
                draggable={inPlaylist}
                onDragStart={() => (dragId.current = t.id)}
                onDragOver={(e) => inPlaylist && e.preventDefault()}
                onDrop={async () => {
                  if (view.view !== "playlist" || dragId.current == null || dragId.current === t.id) return;
                  const ids = visible.map((x) => x.id);
                  const from = ids.indexOf(dragId.current);
                  const to = ids.indexOf(t.id);
                  ids.splice(to, 0, ids.splice(from, 1)[0]);
                  dragId.current = null;
                  await api.playlistReorder(Number(view.value), ids);
                  qc.invalidateQueries({ queryKey: ["lib", "tracks", view] });
                }}
                className={clsx(
                  "group grid grid-cols-[38px_1fr_200px_120px_72px_64px] items-center gap-3 border-b border-elev px-[18px] py-[7px]",
                  isPlaying ? "bg-green-bg shadow-[inset_2px_0_0_var(--c-green)]" : "hover:bg-hover"
                )}
              >
                <button onClick={() => playTrack(t)} className="grid place-items-center text-faint">
                  <span className="text-[12px] tabular-nums group-hover:hidden">{i + 1}</span>
                  <span className="hidden text-text group-hover:block">
                    <PlayIcon size={13} />
                  </span>
                </button>
                <div className="flex min-w-0 items-center gap-[11px]">
                  <ArtThumb track={t} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">{t.title}</div>
                    <div className="mt-px truncate text-[11.5px] text-faint">{t.artist}</div>
                  </div>
                </div>
                <div className="truncate text-[12.5px] text-dim">{t.album}</div>
                <div className="truncate text-[12.5px] text-dim">{t.genre}</div>
                {view.view === "playlist" ? (
                  <button
                    onClick={async () => {
                      await api.playlistRemove(Number(view.value), t.id);
                      qc.invalidateQueries({ queryKey: ["lib", "tracks", view] });
                    }}
                    className="grid h-7 w-7 place-items-center justify-self-center rounded-md text-faint opacity-0 hover:text-red group-hover:opacity-100"
                    aria-label="Remove from playlist"
                    title="Remove from playlist"
                  >
                    <XIcon size={14} />
                  </button>
                ) : (
                  <div className="flex items-center justify-self-center">
                    {isMp3(t) && (
                      <button
                        onClick={() => setEditing(t)}
                        className="grid h-7 w-7 place-items-center rounded-md text-faint opacity-0 transition-colors hover:text-text group-hover:opacity-100"
                        aria-label="Edit song"
                        title="Edit song"
                      >
                        <PencilIcon size={14} />
                      </button>
                    )}
                    <button
                      onClick={() =>
                        fav.toggle({ ref: t.path, name: t.title, logo: t.artPath, meta: t })
                      }
                      className={clsx(
                        "grid h-7 w-7 place-items-center rounded-md transition-colors",
                        fav.isFav(t.path)
                          ? "text-yellow"
                          : "text-faint opacity-0 hover:text-text group-hover:opacity-100"
                      )}
                      aria-label="Toggle favorite"
                    >
                      <StarIcon size={15} filled={fav.isFav(t.path)} />
                    </button>
                  </div>
                )}
                <div className="text-right text-[12px] tabular-nums text-dim">{fmtDur(t.durationSec)}</div>
              </div>
            );
          })}
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.track)} onClose={() => setMenu(null)} />
      )}
      {editing && <AudioEditor track={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ArtThumb({ track }: { track: Track }) {
  const src = track.artPath ? convertFileSrc(track.artPath) : null;
  if (src) {
    return <img src={src} alt="" className="h-[38px] w-[38px] flex-none rounded-[6px] object-cover" />;
  }
  return (
    <div
      className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[6px] text-[15px] font-extrabold text-[var(--c-on-accent)]"
      style={{ background: "linear-gradient(135deg,var(--c-green),var(--c-green-d))" }}
    >
      {track.title.charAt(0).toUpperCase()}
    </div>
  );
}

function BrowseList({
  kind,
  onPick,
}: {
  kind: "artists" | "albums" | "genres";
  onPick: (v: import("../api/types").LibraryView) => void;
}) {
  const enabled = isTauri();
  const artists = useQuery({ queryKey: ["lib", "artists"], queryFn: api.libraryArtists, enabled: enabled && kind === "artists" });
  const albums = useQuery({ queryKey: ["lib", "albums"], queryFn: api.libraryAlbums, enabled: enabled && kind === "albums" });
  const genres = useQuery({ queryKey: ["lib", "genres"], queryFn: api.libraryGenres, enabled: enabled && kind === "genres" });

  const rows =
    kind === "artists"
      ? (artists.data ?? []).map((a) => ({ key: a.name, label: a.name, sub: `${a.count} songs`, pick: { view: "artist", value: a.name } as const }))
      : kind === "albums"
        ? (albums.data ?? []).map((a) => ({ key: a.name, label: a.name, sub: a.artist, pick: { view: "album", value: a.name } as const }))
        : (genres.data ?? []).map((g) => ({ key: g.name, label: g.name, sub: `${g.count} songs`, pick: { view: "genre", value: g.name } as const }));

  return (
    <div className="flex-1 overflow-auto p-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        {rows.map((r) => (
          <button
            key={r.key}
            onClick={() => onPick(r.pick)}
            className="flex items-center gap-3 rounded-[10px] border border-border bg-elev px-3 py-3 text-left transition-colors hover:border-border-strong hover:bg-hover"
          >
            <div
              className="grid h-[42px] w-[42px] flex-none place-items-center rounded-[8px] text-[16px] font-extrabold text-[var(--c-on-accent)]"
              style={{ background: "linear-gradient(135deg,var(--c-green),var(--c-green-d))" }}
            >
              {r.label.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">{r.label}</div>
              <div className="truncate text-[11.5px] text-faint">{r.sub}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
