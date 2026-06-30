import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "../api/client";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { isTauri } from "../lib/os";
import { openUrl } from "@tauri-apps/plugin-opener";
import { usePlayer } from "../store/player";
import { useYouTubePlayer } from "../hooks/useYouTubePlayer";
import { parseYouTubeInput } from "../lib/youtube";
import { openSettings } from "../lib/modalWindow";
import { useFavorites, favMeta } from "../hooks/useFavorites";
import { loadYoutubeUi, saveYoutubeUi } from "../lib/uiState";
import {
  DEFAULT_GROUP,
  loadYtGroups,
  saveYtGroups,
  groupOf,
  createGroup,
  assignToGroup,
  renameGroup,
  deleteGroup,
  orderedGroups,
  prune,
  type YtFavGroups,
} from "../lib/ytGroups";
import {
  SearchIcon,
  YouTubeIcon,
  StarIcon,
  PlayIcon,
  PlaylistIcon,
  XIcon,
  BanIcon,
  RotateIcon,
  FolderIcon,
  PencilIcon,
  TrashIcon,
  PlusIcon,
} from "../lib/icons";
import type { YoutubeItem, YoutubePlaylistInfo } from "../api/types";
import { QueuePanel, RowControls, SelectAllControl, BulkBar, downloadMenuItems } from "@downloader";

// In the Tauri webview window.open() is a no-op — it doesn't reach the system
// browser. Route through the opener plugin; fall back to window.open in a plain
// browser (dev) where the plugin isn't present.
function openOnYouTube(videoId: string) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  if (isTauri()) openUrl(url).catch(() => {});
  else window.open(url, "_blank");
}

export function YouTubeMode() {
  const setYoutubeCount = usePlayer((s) => s.setYoutubeCount);
  const setNowPlaying = usePlayer((s) => s.setNowPlaying);
  const setPlaying = usePlayer((s) => s.setPlaying);
  const setTransport = usePlayer((s) => s.setTransport);
  const showToast = usePlayer((s) => s.showToast);
  const fav = useFavorites("youtube");
  const qc = useQueryClient();

  const yu = useRef(loadYoutubeUi()).current;
  const [text, setText] = useState(yu.text);
  const [query, setQuery] = useState(yu.query);
  const [playlistId, setPlaylistId] = useState<string | null>(yu.playlistId);
  const [directItems, setDirectItems] = useState<YoutubeItem[]>(yu.directItems); // a pasted single video
  const [tab, setTab] = useState<"results" | "favorites">(yu.tab);
  const [selected, setSelected] = useState<YoutubeItem | null>(yu.selected);
  const [blocked, setBlocked] = useState<string | null>(null); // videoId that won't embed
  const [autoplay, setAutoplay] = useState(() => localStorage.getItem("mc.ytAutoplay") !== "0");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set()); // rail items hidden this session
  const [showRemoved, setShowRemoved] = useState(false); // per-playlist trash strip
  const [filter, setFilter] = useState(""); // instant client-side filter over the loaded list
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  // Saved-songs grouping (Saved tab). Persisted to localStorage on every change.
  const [groups, setGroupsState] = useState<YtFavGroups>(() => loadYtGroups());
  const setGroups = (g: YtFavGroups) => {
    setGroupsState(g);
    saveYtGroups(g);
  };
  // newGroupFor: a videoId to file into the group once created, or "panel" for
  // the standalone "+ New group" control; renaming: the group being renamed.
  const [newGroupFor, setNewGroupFor] = useState<string | null>(null);
  const [newGroupText, setNewGroupText] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  // Native drag-and-drop: the song being dragged + the group header hovered.
  const [dragVideo, setDragVideo] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const skipsRef = useRef(0);
  const activeRowRef = useRef<HTMLDivElement>(null); // now-playing row, for scroll-into-view

  // persist this tab's browsing state so it restores on return / restart
  useEffect(() => {
    saveYoutubeUi({ text, query, playlistId, directItems, tab, selected });
  }, [text, query, playlistId, directItems, tab, selected]);

  // Clear the quick-filter whenever the underlying list changes (new playlist,
  // new search, tab switch) so a stale query never hides a freshly loaded list.
  useEffect(() => {
    setFilter("");
  }, [playlistId, query, tab, directItems]);

  // true only for the one restore-mount, so a restored video stays paused
  const restoredSelRef = useRef(yu.selected != null);

  // Saved favorites split into individual videos and whole playlists.
  const favMetas = fav.items.map((f) => favMeta<any>(f)).filter(Boolean);
  const favVideos: YoutubeItem[] = favMetas.filter((m: any) => m && m.videoId);
  const favPlaylists: YoutubePlaylistInfo[] = favMetas.filter((m: any) => m && m.playlistId);

  const search = useQuery({
    queryKey: ["youtube", query],
    queryFn: () => api.youtubeSearch(query),
    enabled: isTauri() && !playlistId && directItems.length === 0 && query.trim().length > 0,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const playlist = useQuery({
    queryKey: ["youtube-playlist", playlistId],
    queryFn: () => api.youtubePlaylist(playlistId!),
    enabled: isTauri() && !!playlistId,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // The loaded playlist's own title / cover, for the Save-playlist control.
  const playlistInfo = useQuery({
    queryKey: ["youtube-playlist-info", playlistId],
    queryFn: () => api.youtubePlaylistInfo(playlistId!),
    enabled: isTauri() && !!playlistId,
    retry: false,
    staleTime: 30 * 60 * 1000,
  });
  const plInfo = playlistInfo.data ?? null;

  // Persistent deletions: global bans (everywhere) + this playlist's removals.
  const bans = useQuery({
    queryKey: ["yt-bans"],
    queryFn: () => api.ytBans(),
    enabled: isTauri(),
    staleTime: Infinity,
  });
  const playlistHidden = useQuery({
    queryKey: ["yt-hidden", playlistId],
    queryFn: () => api.ytHiddenForPlaylist(playlistId!),
    enabled: isTauri() && !!playlistId,
    staleTime: Infinity,
  });
  const bannedIds = new Set((bans.data ?? []).map((b) => b.videoId));
  const playlistHiddenIds = new Set((playlistHidden.data ?? []).map((h) => h.videoId));

  const error = playlistId ? playlist.error : directItems.length ? null : search.error;
  const isFetching = playlistId ? playlist.isFetching : search.isFetching;
  const items: YoutubeItem[] = playlistId
    ? playlist.data?.items ?? []
    : directItems.length
      ? directItems
      : search.data?.items ?? [];
  // Session hide (this view) + global ban (everywhere) + per-playlist removal.
  const visibleItems = items.filter(
    (v) =>
      !hidden.has(v.videoId) &&
      !bannedIds.has(v.videoId) &&
      (!playlistId || !playlistHiddenIds.has(v.videoId))
  );
  const baseRail = tab === "favorites" ? favVideos : visibleItems;
  // Instant, client-side filter over whatever list is loaded — matches title or
  // channel as you type. No network; just narrows the in-memory list.
  const fq = filter.trim().toLowerCase();
  const matchFq = (v: YoutubeItem) =>
    v.title.toLowerCase().includes(fq) || v.channelTitle.toLowerCase().includes(fq);
  const railItems = fq ? baseRail.filter(matchFq) : baseRail;
  // Transport/advance scope: in the Saved tab a group plays like its own
  // playlist — next/prev/autoplay stay within the selected song's group; in
  // any other view it's just the visible result list.
  const playList =
    tab === "favorites" && selected
      ? favVideos.filter(
          (v) =>
            groupOf(groups, v.videoId) === groupOf(groups, selected.videoId) && (!fq || matchFq(v))
        )
      : railItems;
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const noKey = !!error && msg.includes("no_key");
  const hasList = !!playlistId || !!query || directItems.length > 0;

  const advanceNext = () => {
    const list = playList;
    const idx = list.findIndex((v) => v.videoId === selected?.videoId);
    if (list.length && idx >= 0) setSelected(list[(idx + 1) % list.length]);
  };

  // When a video ends, roll to the next item if autoplay is on.
  const onVideoEnded = () => {
    if (autoplay) advanceNext();
  };

  // A video that won't embed: flag it, and skip ahead when autoplaying (capped
  // so an all-blocked list can't spin forever).
  const onEmbedError = () => {
    setBlocked(selected?.videoId ?? null);
    if (autoplay && skipsRef.current < playList.length) {
      skipsRef.current += 1;
      advanceNext();
    }
  };

  // A successful play clears the blocked flag and resets the skip guard.
  const onPlaying = () => {
    skipsRef.current = 0;
    setBlocked(null);
  };

  // Drive the embedded player from the shared transport store (bottom bar).
  useYouTubePlayer(hostRef, selected?.videoId ?? null, {
    onEnded: onVideoEnded,
    onError: onEmbedError,
    onPlaying,
  });

  const toggleAutoplay = () => {
    const v = !autoplay;
    setAutoplay(v);
    localStorage.setItem("mc.ytAutoplay", v ? "1" : "0");
  };

  // Drop an item from the current list for this session (not from YouTube).
  const hideItem = (id: string) => {
    if (id === selected?.videoId) advanceNext();
    setHidden((prev) => new Set(prev).add(id));
  };

  const hideInput = (it: YoutubeItem) => ({
    videoId: it.videoId,
    title: it.title,
    channelTitle: it.channelTitle,
    thumbnail: it.thumbnail,
  });

  // X — in a playlist: remove from THIS playlist forever; in search: session hide.
  const removeItem = async (it: YoutubeItem) => {
    if (it.videoId === selected?.videoId) advanceNext();
    if (playlistId) {
      const pid = playlistId;
      await api.ytHide(pid, hideInput(it));
      qc.invalidateQueries({ queryKey: ["yt-hidden", pid] });
      showToast("Removed from playlist", async () => {
        await api.ytRestore(pid, it.videoId);
        qc.invalidateQueries({ queryKey: ["yt-hidden", pid] });
      });
    } else {
      hideItem(it.videoId);
    }
  };

  // ⊘ — ban everywhere (every playlist + search), forever.
  const banItem = async (it: YoutubeItem) => {
    if (it.videoId === selected?.videoId) advanceNext();
    await api.ytBan(hideInput(it));
    qc.invalidateQueries({ queryKey: ["yt-bans"] });
    if (playlistId) qc.invalidateQueries({ queryKey: ["yt-hidden", playlistId] });
    showToast("Banned everywhere", async () => {
      await api.ytUnban(it.videoId);
      qc.invalidateQueries({ queryKey: ["yt-bans"] });
    });
  };

  const restoreHidden = async (videoId: string) => {
    if (!playlistId) return;
    const pid = playlistId;
    await api.ytRestore(pid, videoId);
    qc.invalidateQueries({ queryKey: ["yt-hidden", pid] });
  };

  // Save / unsave the loaded playlist as a favorite.
  const playlistSaved = !!playlistId && fav.isFav(playlistId);
  const savePlaylist = () => {
    if (!playlistId) return;
    const title = plInfo?.title ?? "Playlist";
    const thumbnail = plInfo?.thumbnail ?? baseRail[0]?.thumbnail ?? "";
    fav.toggle({
      ref: playlistId,
      name: title,
      logo: thumbnail,
      meta: { playlistId, title, channelTitle: plInfo?.channelTitle ?? "", thumbnail },
    });
  };

  // Open a saved playlist (fetches it fresh).
  const loadSavedPlaylist = (pl: YoutubePlaylistInfo) => {
    setBlocked(null);
    skipsRef.current = 0;
    setHidden(new Set());
    setDirectItems([]);
    setSelected(null);
    setQuery("");
    setPlaylistId(pl.playlistId);
    setTab("results");
  };

  // Drop group assignments for songs that are no longer saved. Guard against the
  // empty/loading state so a cold start (favorites query not yet resolved) can't
  // wipe every assignment.
  const favVideoIds = favVideos.map((v) => v.videoId).join(",");
  useEffect(() => {
    if (!favVideoIds) return;
    const valid = new Set(favVideoIds.split(","));
    setGroupsState((g) => {
      const next = prune(g, valid);
      if (next !== g) saveYtGroups(next);
      return next;
    });
  }, [favVideoIds]);

  const moveToGroup = (videoId: string, name: string) =>
    setGroups(assignToGroup(groups, videoId, name));

  // Play a whole group like a playlist: jump to the Saved tab and select its
  // first song; the group-scoped playList carries next/prev/autoplay onward.
  const playGroup = (name: string) => {
    const songs = favVideos.filter((v) => groupOf(groups, v.videoId) === name);
    if (songs.length) {
      setTab("favorites");
      setSelected(songs[0]);
    }
  };

  // newGroupFor === "" → standalone "+ New group"; a videoId → also file that
  // song into the group once it's created.
  const submitNewGroup = () => {
    const { next, name } = createGroup(groups, newGroupText);
    let g = next;
    if (name && newGroupFor) g = assignToGroup(g, newGroupFor, name);
    setGroups(g);
    setNewGroupFor(null);
    setNewGroupText("");
  };

  const submitRename = () => {
    if (renaming) setGroups(renameGroup(groups, renaming, renameText));
    setRenaming(null);
    setRenameText("");
  };

  const removeGroup = (name: string) => setGroups(deleteGroup(groups, name));

  // Parse the box: a video or playlist link/id, otherwise a normal search.
  const submitInput = async () => {
    const t = text.trim();
    const parsed = parseYouTubeInput(t);
    setBlocked(null);
    setHidden(new Set());
    skipsRef.current = 0;
    setTab("results");
    if (parsed.kind === "playlist") {
      setDirectItems([]);
      setSelected(null);
      setQuery("");
      setPlaylistId(parsed.id);
    } else if (parsed.kind === "video") {
      setPlaylistId(null);
      setQuery("");
      try {
        const res = await api.youtubeVideo(parsed.id);
        const vid = res.items[0];
        if (vid) {
          setDirectItems([vid]);
          setSelected(vid);
        } else {
          setDirectItems([]);
          setSelected(null);
          setQuery(t);
        }
      } catch {
        setDirectItems([]);
        setSelected(null);
        setQuery(t);
      }
    } else {
      setPlaylistId(null);
      setDirectItems([]);
      setSelected(null);
      setQuery(t);
    }
  };

  useEffect(() => {
    setYoutubeCount(hasList ? items.length : null);
    return () => setYoutubeCount(null);
  }, [items.length, hasList, setYoutubeCount]);

  useEffect(() => {
    if (items.length && !selected) setSelected(items[0]);
  }, [items, selected]);

  // Surface the selected video on the bottom transport bar. A fresh pick plays;
  // a restored selection (the one restore-mount) stays paused.
  useEffect(() => {
    if (!selected) return;
    setBlocked(null); // a fresh pick is not (yet) blocked
    setPlaying(restoredSelRef.current ? false : true);
    if (restoredSelRef.current) restoredSelRef.current = false;
    setNowPlaying({
      source: "youtube",
      name: selected.title,
      logo: selected.thumbnail,
      sub: selected.channelTitle,
      live: false,
      quality: null,
    });
  }, [selected, setNowPlaying, setPlaying]);

  // Register prev/next over the visible result list for the bottom bar.
  useEffect(() => {
    const list = playList;
    const idx = list.findIndex((v) => v.videoId === selected?.videoId);
    setTransport(
      () => {
        if (list.length) setSelected(list[(idx + 1 + list.length) % list.length]);
      },
      () => {
        if (list.length) setSelected(list[(idx - 1 + list.length) % list.length]);
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playList, selected]);

  // Keep the now-playing row visible: when the selection advances (next/prev/
  // auto-advance/click) scroll it into view. "nearest" = no jump when already
  // on screen.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected?.videoId]);

  // Context-menu items for a result/saved row. Saved (favorited) rows also get
  // group controls (move to group / new group / remove from group).
  const rowMenu = (it: YoutubeItem): MenuItem[] => {
    const items: MenuItem[] = [
      { icon: <PlayIcon size={12} />, label: "Play", onClick: () => setSelected(it) },
      {
        icon: <StarIcon size={14} filled={fav.isFav(it.videoId)} />,
        label: fav.isFav(it.videoId) ? "Remove from favorites" : "Add to favorites",
        onClick: () => fav.toggle({ ref: it.videoId, name: it.title, logo: it.thumbnail, meta: it }),
      },
    ];
    if (fav.isFav(it.videoId)) {
      const cur = groupOf(groups, it.videoId);
      items.push({
        separatorBefore: true,
        icon: <FolderIcon size={13} />,
        label: "Move to group",
        submenu: [
          ...orderedGroups(groups).map((name) => ({
            icon: <FolderIcon size={13} />,
            label: name === cur ? `${name} ✓` : name,
            onClick: () => moveToGroup(it.videoId, name),
          })),
          {
            separatorBefore: true,
            icon: <PlusIcon size={13} />,
            label: "New group…",
            onClick: () => {
              setNewGroupFor(it.videoId);
              setNewGroupText("");
            },
          },
        ],
      });
      if (cur !== DEFAULT_GROUP)
        items.push({
          icon: <XIcon size={13} />,
          label: "Remove from group",
          onClick: () => moveToGroup(it.videoId, DEFAULT_GROUP),
        });
    }
    items.push(...downloadMenuItems(it));
    return items;
  };

  // One result/saved row. In the Saved tab, favorited rows are draggable onto a
  // group header to file them.
  const renderRow = (it: YoutubeItem) => {
    const draggable = tab === "favorites" && fav.isFav(it.videoId);
    return (
      <div
        key={it.videoId}
        ref={selected?.videoId === it.videoId ? activeRowRef : undefined}
        draggable={draggable}
        onDragStart={
          draggable
            ? (e) => {
                e.dataTransfer.setData("text/plain", it.videoId);
                e.dataTransfer.effectAllowed = "move";
                setDragVideo(it.videoId);
              }
            : undefined
        }
        onDragEnd={
          draggable
            ? () => {
                setDragVideo(null);
                setDragOverGroup(null);
              }
            : undefined
        }
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, items: rowMenu(it) });
        }}
        className={clsx(
          "group relative mb-1 flex w-full items-start gap-[10px] rounded-[9px] p-[8px]",
          dragVideo === it.videoId && "opacity-40",
          selected?.videoId === it.videoId
            ? "border border-green-bd bg-green-bg"
            : "border border-transparent hover:bg-hover"
        )}
      >
        <RowControls item={it} />
        <button
          onClick={() => setSelected(it)}
          className="flex min-w-0 flex-1 items-start gap-[10px] text-left"
        >
          <div className="relative h-[50px] w-[88px] flex-none">
            <img
              src={it.thumbnail}
              alt=""
              loading="lazy"
              className="h-full w-full rounded-[6px] object-cover"
            />
            <div
              className={clsx(
                "absolute inset-0 grid place-items-center rounded-[6px] bg-black/45 transition-opacity",
                selected?.videoId === it.videoId
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100"
              )}
            >
              <PlayIcon size={20} className="text-white" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[12.5px] font-medium leading-snug">{it.title}</div>
            <div className="mt-1 truncate text-[11px] text-faint">{it.channelTitle}</div>
          </div>
        </button>
        {/* Favorited indicator while idle: one star pinned to the right edge, no
            reserved layout width. Fades out as the hover toolbar fades in. */}
        {fav.isFav(it.videoId) && (
          <div className="pointer-events-none absolute right-[10px] top-1/2 z-0 -translate-y-1/2 text-yellow transition-opacity group-hover:opacity-0">
            <StarIcon size={15} filled />
          </div>
        )}
        {/* Hover toolbar floats over the title's right edge with a solid backdrop,
            so it reserves zero flow width — the title spans the whole row when
            idle and is only covered while hovering. */}
        <div className="pointer-events-none absolute right-[6px] top-1/2 z-10 flex -translate-y-1/2 items-center gap-[2px] rounded-[8px] bg-elev p-[3px] opacity-0 shadow-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <button
            onClick={() => fav.toggle({ ref: it.videoId, name: it.title, logo: it.thumbnail, meta: it })}
            title={fav.isFav(it.videoId) ? "Remove from favorites" : "Save to favorites"}
            className={clsx(
              "grid h-[26px] w-[26px] place-items-center rounded-md transition-colors",
              fav.isFav(it.videoId) ? "text-yellow" : "text-faint hover:text-text"
            )}
            aria-label="Toggle favorite"
          >
            <StarIcon size={15} filled={fav.isFav(it.videoId)} />
          </button>
          {tab !== "favorites" && (
            <>
              <button
                onClick={() => removeItem(it)}
                title={playlistId ? "Remove from this playlist" : "Remove from this list"}
                aria-label="Remove"
                className="grid h-[26px] w-[26px] place-items-center rounded-md text-faint transition-colors hover:text-red"
              >
                <XIcon size={14} />
              </button>
              <button
                onClick={() => banItem(it)}
                title="Ban everywhere — never show again"
                aria-label="Ban everywhere"
                className="grid h-[26px] w-[26px] place-items-center rounded-md text-faint transition-colors hover:text-red"
              >
                <BanIcon size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  // A draggable group header in the Saved tab: name, count, play-as-playlist,
  // and (for named groups) rename / delete. Songs drop onto it to be filed.
  const renderGroupHeader = (name: string, count: number) => {
    const isDefault = name === DEFAULT_GROUP;
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (dragVideo) setDragOverGroup(name);
        }}
        onDragLeave={() => setDragOverGroup((g) => (g === name ? null : g))}
        onDrop={(e) => {
          e.preventDefault();
          if (dragVideo) moveToGroup(dragVideo, name);
          setDragVideo(null);
          setDragOverGroup(null);
        }}
        className={clsx(
          "mb-1 mt-2 flex items-center gap-[6px] rounded-[7px] px-2 py-[5px] transition-colors",
          dragOverGroup === name ? "bg-green-bg ring-1 ring-green-bd" : "hover:bg-hover"
        )}
      >
        {renaming === name ? (
          <input
            autoFocus
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") {
                setRenaming(null);
                setRenameText("");
              }
            }}
            className="min-w-0 flex-1 rounded border border-border-strong bg-elev px-[6px] py-[2px] text-[11px] text-text outline-none"
          />
        ) : (
          <>
            <FolderIcon size={12} className="flex-none text-faint" />
            <span className="min-w-0 flex-1 truncate text-[10px] font-bold tracking-[.6px] text-faint">
              {name.toUpperCase()}
              <span className="ml-[6px] font-semibold text-faint/70">{count}</span>
            </span>
            {count > 0 && (
              <button
                onClick={() => playGroup(name)}
                title="Play group"
                aria-label="Play group"
                className="grid h-[22px] w-[22px] flex-none place-items-center rounded-md text-faint hover:text-text"
              >
                <PlayIcon size={13} />
              </button>
            )}
            {!isDefault && (
              <>
                <button
                  onClick={() => {
                    setRenaming(name);
                    setRenameText(name);
                  }}
                  title="Rename group"
                  aria-label="Rename group"
                  className="grid h-[22px] w-[22px] flex-none place-items-center rounded-md text-faint hover:text-text"
                >
                  <PencilIcon size={13} />
                </button>
                <button
                  onClick={() => removeGroup(name)}
                  title="Delete group (keeps the songs)"
                  aria-label="Delete group"
                  className="grid h-[22px] w-[22px] flex-none place-items-center rounded-md text-faint hover:text-red"
                >
                  <TrashIcon size={13} />
                </button>
              </>
            )}
          </>
        )}
      </div>
    );
  };

  if (noKey) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center p-6">
        <div className="max-w-[360px] text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-[14px] bg-elev text-red">
            <YouTubeIcon size={28} />
          </div>
          <div className="text-[15px] font-semibold text-text">Add a YouTube API key</div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
            YouTube search needs a Google Data API v3 key. Add one in Settings — it's stored
            locally and used only for search.
          </p>
          <button
            onClick={() => void openSettings()}
            className="mt-4 rounded-[8px] bg-green px-4 py-2 text-[12.5px] font-semibold text-[var(--c-on-accent)] hover:bg-[var(--c-green-h)]"
          >
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* search */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitInput();
        }}
        className="flex h-[52px] flex-none items-center gap-3 border-b border-border px-4"
      >
        <div className="text-[13px] text-dim">
          <b className="font-[650] text-text">{hasList ? items.length : 0}</b>{" "}
          {playlistId ? "in playlist" : "results"}
        </div>
        <div className="flex flex-1 items-center gap-[9px] rounded-[9px] border border-border bg-elev px-3 py-2 text-dim focus-within:border-border-strong">
          <SearchIcon size={15} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search, or paste a video / playlist link…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
          />
        </div>
        <button
          type="submit"
          className="rounded-[8px] bg-green px-4 py-[7px] text-[12.5px] font-semibold text-[var(--c-on-accent)] hover:bg-[var(--c-green-h)]"
        >
          Go
        </button>
        {playlistId && (
          <button
            type="button"
            onClick={savePlaylist}
            title={playlistSaved ? "Remove playlist from favorites" : "Save playlist to favorites"}
            className={clsx(
              "flex flex-none items-center gap-[6px] rounded-[8px] border px-3 py-[7px] text-[12.5px] font-medium transition-colors",
              playlistSaved
                ? "border-yellow/40 bg-elev text-yellow"
                : "border-border bg-elev text-dim hover:bg-hover hover:text-text"
            )}
          >
            <StarIcon size={14} filled={playlistSaved} />
            {playlistSaved ? "Saved" : "Save playlist"}
          </button>
        )}
      </form>

      <div className="flex min-h-0 flex-1">
        {/* player */}
        <div className="flex flex-1 flex-col gap-3 p-4" style={{ minWidth: 0 }}>
          <div className="relative flex-1 overflow-hidden rounded-[12px] border border-border-strong bg-black">
            {/* The YouTube IFrame Player API mounts its iframe inside this host. */}
            <div ref={hostRef} className="absolute inset-0 h-full w-full" />
            {!selected && (
              <div className="absolute inset-0 grid place-items-center text-dim">
                <div className="text-center">
                  <div className="text-[15px] font-medium text-text">
                    {error ? "Search failed" : isFetching ? "Searching…" : "Search YouTube"}
                  </div>
                  <div className="mt-1 text-[12.5px]">
                    {error ? msg : "Search, or paste a video / playlist link above"}
                  </div>
                </div>
              </div>
            )}
            {selected && blocked === selected.videoId && (
              <div className="absolute inset-0 grid place-items-center bg-black/85 px-6 text-center">
                <div className="max-w-[340px]">
                  <div className="text-[14px] font-semibold text-text">Can't play here</div>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                    The owner has disabled playback on other sites for this video. You can still
                    watch it on YouTube.
                  </p>
                  <button
                    onClick={() => openOnYouTube(selected.videoId)}
                    className="mt-4 rounded-[8px] bg-green px-4 py-2 text-[12.5px] font-semibold text-[var(--c-on-accent)] hover:bg-[var(--c-green-h)]"
                  >
                    Open on YouTube
                  </button>
                </div>
              </div>
            )}
          </div>
          {selected && (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold">{selected.title}</div>
                <div className="mt-px text-[12px] text-dim">{selected.channelTitle}</div>
              </div>
              <button
                onClick={() => fav.toggle({ ref: selected.videoId, name: selected.title, logo: selected.thumbnail, meta: selected })}
                title={fav.isFav(selected.videoId) ? "Remove from favorites" : "Save to favorites"}
                className={clsx(
                  "flex flex-none items-center gap-1 rounded-[7px] border border-border px-3 py-[6px] text-[12px] transition-colors",
                  fav.isFav(selected.videoId)
                    ? "bg-elev text-yellow"
                    : "bg-elev text-dim hover:bg-hover hover:text-text"
                )}
                aria-label="Toggle favorite"
              >
                <StarIcon size={14} filled={fav.isFav(selected.videoId)} />
                {fav.isFav(selected.videoId) ? "Saved" : "Save"}
              </button>
              <button
                onClick={() => openOnYouTube(selected.videoId)}
                className="flex-none rounded-[7px] border border-border bg-elev px-3 py-[6px] text-[12px] text-dim hover:bg-hover hover:text-text"
              >
                Open on YouTube
              </button>
            </div>
          )}
        </div>

        {/* results rail */}
        <div className="flex w-[330px] flex-none flex-col border-l border-border">
          <div className="flex items-center gap-1 px-[12px] pb-2 pt-3">
            <button
              onClick={() => setTab("results")}
              className={clsx(
                "rounded-[6px] px-2 py-1 text-[11px] font-bold tracking-[.6px] transition-colors",
                tab === "results" ? "bg-elev text-text" : "text-faint hover:text-dim"
              )}
            >
              {playlistId ? "PLAYLIST" : "RESULTS"}
            </button>
            <button
              onClick={() => setTab("favorites")}
              className={clsx(
                "flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-bold tracking-[.6px] transition-colors",
                tab === "favorites" ? "bg-elev text-text" : "text-faint hover:text-dim"
              )}
            >
              <StarIcon size={12} filled={tab === "favorites"} /> SAVED{fav.count ? ` (${fav.count})` : ""}
            </button>
          </div>

          {/* autoplay — roll to the next result when a video ends */}
          <div className="flex items-center justify-between border-y border-border px-[14px] py-[9px]">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-text">Autoplay</div>
              <div className="text-[11px] text-faint">Play the next result automatically</div>
            </div>
            <button
              onClick={toggleAutoplay}
              role="switch"
              aria-checked={autoplay}
              title={autoplay ? "Autoplay is on" : "Autoplay is off"}
              className={clsx(
                "relative h-[20px] w-[36px] flex-none rounded-full transition-colors",
                autoplay ? "bg-green" : "bg-border-strong"
              )}
            >
              <span
                className="absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white transition-all"
                style={{ left: autoplay ? 18 : 2 }}
              />
            </button>
          </div>

          {/* Instant filter over the loaded list — type to narrow by title/channel. */}
          {baseRail.length > 0 && (
            <div className="px-[14px] pb-[6px] pt-[9px]">
              <div className="flex items-center gap-[8px] rounded-[9px] border border-border bg-elev px-[10px] py-[6px] text-dim focus-within:border-border-strong">
                <SearchIcon size={14} />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={`Filter ${playlistId ? "playlist" : tab === "favorites" ? "saved" : "results"}…`}
                  className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-faint"
                />
                {filter && (
                  <button
                    type="button"
                    onClick={() => setFilter("")}
                    aria-label="Clear filter"
                    className="grid h-[18px] w-[18px] flex-none place-items-center rounded text-faint hover:text-text"
                  >
                    <XIcon size={13} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Select-all sits left-aligned under the autoplay row (private build only). */}
          <SelectAllControl items={railItems} />

          <div className="flex-1 overflow-auto px-[10px] pb-[14px] pt-[6px]">
            {(tab === "favorites"
              ? favPlaylists.length === 0 && railItems.length === 0
              : railItems.length === 0) ? (
              <div className="px-2 pt-10 text-center text-[12.5px] text-faint">
                {fq
                  ? `No matches for “${filter.trim()}”.`
                  : tab === "favorites"
                    ? "Nothing saved yet. Tap ★ on a video, or Save playlist up top."
                    : isFetching
                      ? "Loading…"
                      : hasList
                        ? "No results."
                        : "Results appear here."}
              </div>
            ) : tab === "favorites" ? (
              <>
                {favPlaylists.length > 0 && (
                  <>
                    <div className="px-2 pb-1 pt-1 text-[10px] font-bold tracking-[.6px] text-faint">
                      PLAYLISTS
                    </div>
                    {favPlaylists.map((pl) => (
                      <div
                        key={pl.playlistId}
                        className="group mb-1 flex w-full items-center gap-[10px] rounded-[9px] border border-transparent p-[8px] hover:bg-hover"
                      >
                        <button
                          onClick={() => loadSavedPlaylist(pl)}
                          className="flex min-w-0 flex-1 items-center gap-[10px] text-left"
                        >
                          <div className="relative h-[44px] w-[60px] flex-none">
                            {pl.thumbnail ? (
                              <img
                                src={pl.thumbnail}
                                alt=""
                                loading="lazy"
                                className="h-full w-full rounded-[6px] object-cover"
                              />
                            ) : (
                              <div className="grid h-full w-full place-items-center rounded-[6px] bg-elev text-dim">
                                <PlaylistIcon size={18} />
                              </div>
                            )}
                            <div className="absolute bottom-[3px] right-[3px] grid h-[16px] w-[16px] place-items-center rounded bg-black/70 text-white">
                              <PlaylistIcon size={11} />
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 text-[12.5px] font-medium leading-snug">
                              {pl.title}
                            </div>
                            <div className="mt-1 truncate text-[11px] text-faint">
                              Playlist{pl.channelTitle ? ` · ${pl.channelTitle}` : ""}
                            </div>
                          </div>
                        </button>
                        <button
                          onClick={() =>
                            fav.toggle({ ref: pl.playlistId, name: pl.title, logo: pl.thumbnail, meta: pl })
                          }
                          title="Remove playlist from favorites"
                          aria-label="Remove playlist"
                          className="grid h-7 w-7 flex-none place-items-center rounded-md text-faint opacity-0 transition-colors hover:text-text group-hover:opacity-100"
                        >
                          <XIcon size={14} />
                        </button>
                      </div>
                    ))}
                  </>
                )}
                {orderedGroups(groups).map((name) => {
                  const songs = favVideos.filter((v) => groupOf(groups, v.videoId) === name);
                  const shown = fq ? songs.filter(matchFq) : songs;
                  // Hide an empty default group; while filtering, hide no-match groups.
                  if (fq && shown.length === 0) return null;
                  if (!fq && name === DEFAULT_GROUP && songs.length === 0) return null;
                  return (
                    <div key={name}>
                      {renderGroupHeader(name, shown.length)}
                      {shown.map(renderRow)}
                    </div>
                  );
                })}
                {newGroupFor !== null ? (
                  <input
                    autoFocus
                    value={newGroupText}
                    onChange={(e) => setNewGroupText(e.target.value)}
                    onBlur={submitNewGroup}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitNewGroup();
                      if (e.key === "Escape") {
                        setNewGroupFor(null);
                        setNewGroupText("");
                      }
                    }}
                    placeholder="Group name…"
                    className="mt-2 w-full rounded-[7px] border border-border-strong bg-elev px-[8px] py-[5px] text-[12px] text-text outline-none"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setNewGroupFor("");
                      setNewGroupText("");
                    }}
                    className="mt-2 flex w-full items-center gap-[6px] rounded-[7px] border border-dashed border-border px-2 py-[6px] text-[11px] font-semibold text-faint hover:border-border-strong hover:text-dim"
                  >
                    <PlusIcon size={13} /> New group
                  </button>
                )}
              </>
            ) : (
              <>{railItems.map(renderRow)}</>
            )}
          </div>

          <BulkBar />

          {/* per-playlist trash: songs removed from this playlist, restorable */}
          {playlistId && (playlistHidden.data?.length ?? 0) > 0 && (
            <div className="flex-none border-t border-border">
              <button
                onClick={() => setShowRemoved((v) => !v)}
                className="flex w-full items-center justify-between px-[14px] py-[9px] text-[11px] font-bold tracking-[.6px] text-faint hover:text-dim"
              >
                <span>REMOVED ({playlistHidden.data!.length})</span>
                <span>{showRemoved ? "▾" : "▸"}</span>
              </button>
              {showRemoved && (
                <div className="max-h-[180px] overflow-auto px-[10px] pb-[10px]">
                  {playlistHidden.data!.map((h) => (
                    <div
                      key={h.videoId}
                      className="group mb-1 flex items-center gap-[10px] rounded-[8px] p-[6px] hover:bg-hover"
                    >
                      {h.thumbnail ? (
                        <img
                          src={h.thumbnail}
                          alt=""
                          loading="lazy"
                          className="h-[34px] w-[60px] flex-none rounded-[5px] object-cover opacity-70"
                        />
                      ) : (
                        <div className="h-[34px] w-[60px] flex-none rounded-[5px] bg-elev" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] text-dim">{h.title || h.videoId}</div>
                        <div className="truncate text-[10.5px] text-faint">{h.channelTitle}</div>
                      </div>
                      <button
                        onClick={() => restoreHidden(h.videoId)}
                        title="Restore to this playlist"
                        aria-label="Restore"
                        className="grid h-7 w-7 flex-none place-items-center rounded-md text-faint hover:text-text"
                      >
                        <RotateIcon size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      <QueuePanel />
    </div>
  );
}
