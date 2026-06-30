import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
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
import { useMergedSources } from "../hooks/useMergedSources";
import {
  loadCollections,
  saveCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  addSource,
  removeSource,
  setSongRemoved,
  type Collection,
  type SourceRef,
} from "../lib/ytCollections";
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
  DownIcon,
} from "../lib/icons";
import type { YoutubeItem, YoutubePlaylistInfo } from "../api/types";
import {
  QueuePanel,
  RowControls,
  SelectAllControl,
  BulkBar,
  downloadMenuItems,
  DownloadAllPlaylists,
  PlaylistDownloadButton,
  GroupDownloadButton,
} from "@downloader";

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
  const togglePlay = usePlayer((s) => s.togglePlay);
  const setTransport = usePlayer((s) => s.setTransport);
  const showToast = usePlayer((s) => s.showToast);
  // Player controls live in the bottom transport bar now; YouTube just reads
  // them from the shared store (same shuffle/repeat library uses).
  const autoplay = usePlayer((s) => s.autoplay);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const fav = useFavorites("youtube");
  const qc = useQueryClient();

  const yu = useRef(loadYoutubeUi()).current;
  const [text, setText] = useState(yu.text);
  const [query, setQuery] = useState(yu.query);
  const [playlistId, setPlaylistId] = useState<string | null>(yu.playlistId);
  const [directItems, setDirectItems] = useState<YoutubeItem[]>(yu.directItems); // a pasted single video
  const [tab, setTab] = useState<"results" | "favorites">(yu.tab);
  const [selected, setSelected] = useState<YoutubeItem | null>(yu.selected);
  const [sources, setSources] = useState<SourceRef[]>(yu.sources);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(yu.activeCollectionId);
  const [collections, setCollectionsState] = useState<Collection[]>(() => loadCollections());
  const setCollections = (list: Collection[]) => {
    setCollectionsState(list);
    saveCollections(list);
  };
  const mergeMode = sources.length > 0;
  const activeCollection = activeCollectionId
    ? collections.find((c) => c.id === activeCollectionId) ?? null
    : null;
  const [blocked, setBlocked] = useState<string | null>(null); // videoId that won't embed
  const [nearEnd, setNearEnd] = useState(false); // in the final ~20s, where end-screen ads appear
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
  const railParentRef = useRef<HTMLDivElement>(null);
  const skipsRef = useRef(0);
  const activeRowRef = useRef<HTMLDivElement>(null); // now-playing row, for scroll-into-view

  // persist this tab's browsing state so it restores on return / restart
  useEffect(() => {
    saveYoutubeUi({ text, query, playlistId, directItems, tab, selected, sources, activeCollectionId });
  }, [text, query, playlistId, directItems, tab, selected, sources, activeCollectionId]);

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

  // Merge mode: stream + de-dupe every source playlist into one list.
  const merged = useMergedSources(sources);

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

  const error = mergeMode ? null : playlistId ? playlist.error : directItems.length ? null : search.error;
  const isFetching = mergeMode
    ? merged.loading
    : playlistId
      ? playlist.isFetching
      : search.isFetching;
  const items: YoutubeItem[] = mergeMode
    ? merged.mergedItems
    : playlistId
      ? playlist.data?.items ?? []
      : directItems.length
        ? directItems
        : search.data?.items ?? [];
  // Session hide + global ban + per-source removal. In merge mode the per-source
  // removal comes from the open collection's removedIds (organize); in single
  // mode it's the server-side per-playlist hide, unchanged.
  const collRemoved = activeCollection ? new Set(activeCollection.removedIds) : null;
  const visibleItems = items.filter(
    (v) =>
      !hidden.has(v.videoId) &&
      !bannedIds.has(v.videoId) &&
      (mergeMode
        ? !(collRemoved?.has(v.videoId) ?? false)
        : !playlistId || !playlistHiddenIds.has(v.videoId))
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
  const hasList = mergeMode || !!playlistId || !!query || directItems.length > 0;

  // Virtualized rail for the flat results/merge list — only on-screen rows live
  // in the DOM, so a merge of any size scrolls smoothly. The grouped favorites
  // view is rendered normally (manageable sizes).
  const rowVirtual = useVirtualizer({
    count: tab === "results" ? railItems.length : 0,
    getScrollElement: () => railParentRef.current,
    estimateSize: () => 74,
    overscan: 10,
  });

  // Restart-current-video handle, filled in once the player hook returns (used
  // for repeat-one). Held in a ref so the end handler below can reach it.
  const replayRef = useRef<() => void>(() => {});

  // Play history so Back returns the actual last song played (not a fresh random
  // pick under shuffle). Stores the item objects, so Back works even across
  // playlists/groups. `goingBack` guards the recorder from re-pushing the item we
  // just popped.
  const historyRef = useRef<YoutubeItem[]>([]);
  const lastSelRef = useRef<YoutubeItem | null>(selected);
  const goingBackRef = useRef(false);

  // Move to the next track. Honors shuffle (random pick, never the current one);
  // otherwise sequential with wrap. Used by manual next, hide/remove, and the
  // embed-error skip.
  const advanceNext = () => {
    const list = playList;
    if (!list.length) return;
    const idx = list.findIndex((v) => v.videoId === selected?.videoId);
    if (shuffle && list.length > 1) {
      let r = idx;
      while (r === idx) r = Math.floor(Math.random() * list.length);
      setSelected(list[r]);
      return;
    }
    setSelected(list[idx >= 0 ? (idx + 1) % list.length : 0]);
  };

  // End-of-video behavior. Autoplay is the master gate; shuffle + repeat shape
  // what plays next. Repeat-one replays the same video; repeat-off stops at the
  // end of a non-shuffled list.
  const onVideoEnded = () => {
    if (!autoplay) return;
    if (repeat === "one") {
      replayRef.current();
      return;
    }
    const list = playList;
    const idx = list.findIndex((v) => v.videoId === selected?.videoId);
    if (!shuffle && repeat === "off" && idx === list.length - 1) {
      setPlaying(false);
      return;
    }
    advanceNext();
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

  // Playback position → flip the end-screen shield on only for the last ~20s,
  // where YouTube overlays its clickable suggested-video cards. setState bails
  // when the boolean is unchanged, so the 2 Hz ticks are cheap.
  const onTime = (cur: number, dur: number) => {
    setNearEnd(dur > 0 && dur - cur <= 20 && dur - cur >= 0);
  };

  // Drive the embedded player from the shared transport store (bottom bar).
  const { replay } = useYouTubePlayer(hostRef, selected?.videoId ?? null, {
    onEnded: onVideoEnded,
    onError: onEmbedError,
    onPlaying,
    onTime,
  });
  replayRef.current = replay;

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

  // X — merge mode: remove from the open collection (persisted) or, for an
  // unsaved mix, hide for this session. Single playlist: remove forever
  // (server). Search: session hide.
  const removeItem = async (it: YoutubeItem) => {
    if (it.videoId === selected?.videoId) advanceNext();
    if (mergeMode) {
      if (activeCollectionId) {
        setCollections(setSongRemoved(collections, activeCollectionId, it.videoId, true));
        const cid = activeCollectionId;
        showToast("Removed from collection", () =>
          setCollections(setSongRemoved(loadCollections(), cid, it.videoId, false))
        );
      } else {
        hideItem(it.videoId);
      }
      return;
    }
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

  // Add the playlist currently in the input box to the merge (does not replace).
  // Seeds the mix with the current single playlist first, then appends the new
  // one. Entering merge mode clears the single-playlist query so its server-side
  // features don't fight the merged view.
  const addToMix = async () => {
    const parsed = parseYouTubeInput(text.trim());
    if (parsed.kind !== "playlist") {
      showToast("Paste a playlist link to add it to the mix");
      return;
    }
    let info: SourceRef = { playlistId: parsed.id, title: "Playlist" };
    try {
      const meta = await api.youtubePlaylistInfo(parsed.id);
      if (meta?.title) info = { playlistId: parsed.id, title: meta.title };
    } catch {
      /* keep the fallback title */
    }
    const seed: SourceRef[] = sources.length
      ? sources
      : playlistId
        ? [{ playlistId, title: plInfo?.title ?? "Playlist" }]
        : [];
    if (seed.some((s) => s.playlistId === info.playlistId)) {
      showToast("That playlist is already in the mix");
      return;
    }
    setPlaylistId(null);
    setQuery("");
    setDirectItems([]);
    setHidden(new Set());
    setText("");
    setTab("results");
    const next = [...seed, info];
    setSources(next);
    if (activeCollectionId) setCollections(addSource(collections, activeCollectionId, info));
  };

  const removeSourceFromMix = (playlistId: string) => {
    const next = sources.filter((s) => s.playlistId !== playlistId);
    setSources(next);
    if (activeCollectionId) setCollections(removeSource(collections, activeCollectionId, playlistId));
    if (next.length === 0) setActiveCollectionId(null);
  };

  const clearMix = () => {
    setSources([]);
    setActiveCollectionId(null);
    setSelected(null);
  };

  const [savingName, setSavingName] = useState<string | null>(null); // null = closed
  const [renamingColl, setRenamingColl] = useState<string | null>(null);
  const [renameCollText, setRenameCollText] = useState("");
  const [mixOpen, setMixOpen] = useState(false); // build-bar chips collapsed by default to save space

  const submitSaveCollection = () => {
    const { next, created } = createCollection(collections, savingName ?? "", sources);
    if (created) {
      setCollections(next);
      setActiveCollectionId(created.id);
    }
    setSavingName(null);
  };

  // Open a saved collection: its sources drive the merge; future edits persist.
  const openCollection = (c: Collection) => {
    setBlocked(null);
    skipsRef.current = 0;
    setHidden(new Set());
    setDirectItems([]);
    setSelected(null);
    setQuery("");
    setPlaylistId(null);
    setText("");
    setTab("results");
    setActiveCollectionId(c.id);
    setSources(c.sources);
  };

  const submitRenameCollection = () => {
    if (renamingColl) setCollections(renameCollection(collections, renamingColl, renameCollText));
    setRenamingColl(null);
    setRenameCollText("");
  };

  const removeCollection = (id: string) => {
    setCollections(deleteCollection(collections, id));
    if (activeCollectionId === id) clearMix();
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

  // Sidebar badge tracks the list the rail actually shows (after session-hide,
  // global-ban, and per-playlist removal) — not the raw query length, so it
  // drops to 99 the moment you delete a song from a playlist.
  useEffect(() => {
    setYoutubeCount(hasList ? visibleItems.length : null);
    return () => setYoutubeCount(null);
  }, [visibleItems.length, hasList, setYoutubeCount]);

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

  // Record play history on every forward move (next, click, auto-advance, random
  // shuffle pick) so Back can return to the real previous song. A move caused by
  // Back itself is not recorded — it pops, it doesn't push.
  useEffect(() => {
    if (selected?.videoId === lastSelRef.current?.videoId) return;
    if (goingBackRef.current) {
      goingBackRef.current = false;
    } else if (lastSelRef.current) {
      historyRef.current.push(lastSelRef.current);
      if (historyRef.current.length > 200) historyRef.current.shift();
    }
    lastSelRef.current = selected;
  }, [selected]);

  // Register prev/next for the bottom bar. Next moves forward (random under
  // shuffle, else sequential wrap). Back walks the play history — the actual last
  // song played — and only falls back to sequential prev when there's no history.
  useEffect(() => {
    const list = playList;
    const idx = list.findIndex((v) => v.videoId === selected?.videoId);
    const next = () => {
      if (!list.length) return;
      if (shuffle) {
        if (list.length === 1) return setSelected(list[0]);
        let r = idx;
        while (r === idx) r = Math.floor(Math.random() * list.length);
        return setSelected(list[r]);
      }
      setSelected(list[(idx + 1) % list.length]);
    };
    const back = () => {
      const prevItem = historyRef.current.pop();
      if (prevItem) {
        goingBackRef.current = true; // this move is a rewind, don't re-record it
        setSelected(prevItem);
        return;
      }
      if (list.length) setSelected(list[(idx - 1 + list.length) % list.length]);
    };
    setTransport(next, back);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playList, selected, shuffle]);

  // Keep the now-playing row visible: when the selection advances (next/prev/
  // auto-advance/click) scroll it into view. "nearest" = no jump when already
  // on screen. Also drop the end-screen shield so a fresh video doesn't inherit
  // the previous one's "near end" state until its own time ticks arrive.
  useEffect(() => {
    if (tab === "results") {
      const idx = railItems.findIndex((v) => v.videoId === selected?.videoId);
      if (idx >= 0) rowVirtual.scrollToIndex(idx, { align: "auto" });
    } else {
      activeRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    setNearEnd(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        {/* Favorited indicator while idle: one star pinned to the bottom-right
            corner, no reserved layout width. Fades out as the hover toolbar fades
            in — pinned to the same corner so it doesn't jump. */}
        {fav.isFav(it.videoId) && (
          <div className="pointer-events-none absolute bottom-[8px] right-[10px] z-0 text-yellow transition-opacity group-hover:opacity-0">
            <StarIcon size={13} filled />
          </div>
        )}
        {/* Hover toolbar floats at the card's bottom-right with a solid backdrop,
            so it reserves zero flow width — the row text spans the whole card when
            idle and is only covered there while hovering. */}
        <div className="pointer-events-none absolute bottom-[6px] right-[6px] z-10 flex items-center gap-[2px] rounded-[8px] bg-elev p-[2px] opacity-0 shadow-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <button
            onClick={() => fav.toggle({ ref: it.videoId, name: it.title, logo: it.thumbnail, meta: it })}
            title={fav.isFav(it.videoId) ? "Remove from favorites" : "Save to favorites"}
            className={clsx(
              "grid h-[22px] w-[22px] place-items-center rounded-md transition-colors",
              fav.isFav(it.videoId) ? "text-yellow" : "text-faint hover:text-text"
            )}
            aria-label="Toggle favorite"
          >
            <StarIcon size={13} filled={fav.isFav(it.videoId)} />
          </button>
          {tab !== "favorites" && (
            <>
              <button
                onClick={() => removeItem(it)}
                title={playlistId ? "Remove from this playlist" : "Remove from this list"}
                aria-label="Remove"
                className="grid h-[22px] w-[22px] place-items-center rounded-md text-faint transition-colors hover:text-red"
              >
                <XIcon size={12} />
              </button>
              <button
                onClick={() => banItem(it)}
                title="Ban everywhere — never show again"
                aria-label="Ban everywhere"
                className="grid h-[22px] w-[22px] place-items-center rounded-md text-faint transition-colors hover:text-red"
              >
                <BanIcon size={12} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  // A draggable group header in the Saved tab: name, count, play-as-playlist,
  // download, and (for named groups) rename / delete. Songs drop onto it.
  const renderGroupHeader = (name: string, count: number, songs: YoutubeItem[]) => {
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
            <GroupDownloadButton
              name={name}
              items={songs.map((s) => ({ videoId: s.videoId, title: s.title }))}
            />
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
        <button
          type="button"
          onClick={addToMix}
          title="Add this playlist to the mix (don't replace)"
          className="flex flex-none items-center gap-[5px] rounded-[8px] border border-dashed border-green-bd bg-elev px-3 py-[7px] text-[12.5px] font-semibold text-green hover:bg-hover"
        >
          <PlusIcon size={14} /> Add to mix
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
            {/* End-screen click-shield: only the final ~20s, where YouTube
                overlays its clickable suggested-video cards. A transparent layer
                over everything EXCEPT the bottom 48px (native control bar) — so
                those end cards can't be clicked, while the scrub bar and the rest
                of the controls stay usable. The rest of the video is untouched:
                normal click-to-pause, hover controls, and scrubbing all work.
                Clicking the shield toggles play/pause. */}
            {selected && blocked !== selected.videoId && nearEnd && (
              <div
                onClick={togglePlay}
                title="Play / pause"
                aria-hidden
                className="absolute inset-x-0 top-0 z-20 cursor-pointer"
                style={{ bottom: 48 }}
              />
            )}
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

          {/* Player controls (autoplay / shuffle / repeat) moved to the bottom
              transport bar — see TransportBar. The tab row sits flush on the
              filter below now. */}

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

          {mergeMode && (
            <div className="mx-[12px] mb-1 rounded-[10px] border border-border-strong bg-elev p-[10px]">
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => setMixOpen((o) => !o)}
                  title={mixOpen ? "Collapse playlists" : "Expand playlists"}
                  className="flex min-w-0 items-center gap-[6px] text-[10px] font-bold tracking-[.5px] text-green"
                >
                  <DownIcon
                    size={12}
                    className={clsx("flex-none transition-transform", !mixOpen && "-rotate-90")}
                  />
                  <span className="truncate">
                    {activeCollection
                      ? `COLLECTION · ${activeCollection.name.toUpperCase()}`
                      : `BUILDING · ${sources.length} PLAYLISTS`}
                  </span>
                </button>
                <button
                  onClick={clearMix}
                  className="flex-none text-[11px] text-faint hover:text-text"
                >
                  Clear all
                </button>
              </div>

              {/* Counts stay visible even when collapsed — the at-a-glance payoff. */}
              <div className="mt-[8px] flex flex-wrap items-center gap-x-[8px] text-[11px] text-faint">
                <span>
                  <b className="text-text">{visibleItems.length.toLocaleString("en-US")}</b> songs
                </span>
                {merged.removed > 0 && <span>· {merged.removed.toLocaleString("en-US")} dupes removed</span>}
                {merged.loading && <span>· loading more…</span>}
                {Object.keys(merged.errors).length > 0 && (
                  <span className="text-red">· {Object.keys(merged.errors).length} failed</span>
                )}
              </div>

              {mixOpen && (
                <>
                  <div className="mt-[8px] flex flex-wrap gap-[6px]">
                    {sources.map((s) => (
                      <span
                        key={s.playlistId}
                        className="flex items-center gap-[6px] rounded-full border border-border bg-bg px-[9px] py-[3px] text-[11px] text-dim"
                      >
                        <span className="max-w-[130px] truncate">{s.title}</span>
                        <button
                          onClick={() => removeSourceFromMix(s.playlistId)}
                          title="Remove this playlist from the mix"
                          aria-label="Remove playlist"
                          className="text-faint hover:text-red"
                        >
                          <XIcon size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                  {!activeCollection &&
                    (savingName !== null ? (
                      <input
                        autoFocus
                        value={savingName}
                        onChange={(e) => setSavingName(e.target.value)}
                        onBlur={submitSaveCollection}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitSaveCollection();
                          if (e.key === "Escape") setSavingName(null);
                        }}
                        placeholder="Collection name…"
                        className="mt-[8px] w-full rounded-[7px] border border-border-strong bg-bg px-[8px] py-[5px] text-[12px] text-text outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => setSavingName("")}
                        className="mt-[8px] flex items-center gap-[6px] rounded-[7px] border border-dashed border-border px-2 py-[5px] text-[11px] font-semibold text-faint hover:border-border-strong hover:text-dim"
                      >
                        <StarIcon size={12} /> Save as collection
                      </button>
                    ))}
                </>
              )}
            </div>
          )}

          {/* Select-all + bulk-download bar sit under the autoplay row (private
              build only). BulkBar shows MP3/MP4 as soon as songs are selected. */}
          <SelectAllControl items={railItems} />
          <BulkBar />

          <div ref={railParentRef} className="flex-1 overflow-auto px-[10px] pb-[14px] pt-[6px]">
            {(tab === "favorites"
              ? favPlaylists.length === 0 && railItems.length === 0 && collections.length === 0
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
                <DownloadAllPlaylists playlists={favPlaylists} />
                {collections.length > 0 && (
                  <>
                    <div className="px-2 pb-1 pt-1 text-[10px] font-bold tracking-[.6px] text-faint">
                      COLLECTIONS
                    </div>
                    {collections.map((c) => {
                      const songCount = c.sources.length;
                      return (
                        <div
                          key={c.id}
                          className="group mb-1 flex w-full items-center gap-[10px] rounded-[9px] border border-transparent p-[8px] hover:bg-hover"
                        >
                          {renamingColl === c.id ? (
                            <input
                              autoFocus
                              value={renameCollText}
                              onChange={(e) => setRenameCollText(e.target.value)}
                              onBlur={submitRenameCollection}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") submitRenameCollection();
                                if (e.key === "Escape") setRenamingColl(null);
                              }}
                              className="min-w-0 flex-1 rounded border border-border-strong bg-elev px-[6px] py-[3px] text-[12px] text-text outline-none"
                            />
                          ) : (
                            <>
                              <button
                                onClick={() => openCollection(c)}
                                className="flex min-w-0 flex-1 items-center gap-[10px] text-left"
                              >
                                <div className="grid h-[44px] w-[60px] flex-none place-items-center rounded-[6px] bg-green-bg text-green">
                                  <PlaylistIcon size={18} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="line-clamp-2 text-[12.5px] font-medium leading-snug">
                                    {c.name}
                                  </div>
                                  <div className="mt-1 truncate text-[11px] text-faint">
                                    Collection · {songCount} playlist{songCount === 1 ? "" : "s"}
                                  </div>
                                </div>
                              </button>
                              <button
                                onClick={() => {
                                  setRenamingColl(c.id);
                                  setRenameCollText(c.name);
                                }}
                                title="Rename collection"
                                aria-label="Rename collection"
                                className="grid h-7 w-7 flex-none place-items-center rounded-md text-faint opacity-0 transition-colors hover:text-text group-hover:opacity-100"
                              >
                                <PencilIcon size={13} />
                              </button>
                              <button
                                onClick={() => removeCollection(c.id)}
                                title="Delete collection"
                                aria-label="Delete collection"
                                className="grid h-7 w-7 flex-none place-items-center rounded-md text-faint opacity-0 transition-colors hover:text-red group-hover:opacity-100"
                              >
                                <TrashIcon size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
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
                        <PlaylistDownloadButton playlist={pl} />
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
                      {renderGroupHeader(name, shown.length, songs)}
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
              <div style={{ height: rowVirtual.getTotalSize(), position: "relative", width: "100%" }}>
                {rowVirtual.getVirtualItems().map((vi) => (
                  <div
                    key={railItems[vi.index].videoId}
                    data-index={vi.index}
                    ref={rowVirtual.measureElement}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    {renderRow(railItems[vi.index])}
                  </div>
                ))}
              </div>
            )}
          </div>

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
