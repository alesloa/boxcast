import { useState } from "react";
import clsx from "clsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePlayer } from "../store/player";
import { api } from "../api/client";
import { isTauri } from "../lib/os";
import type { Facets, LibraryView } from "../api/types";
import { MusicIcon, RadioIcon, TvIcon, XIcon, YouTubeIcon } from "../lib/icons";

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-[10px] text-[10.5px] font-bold tracking-[.8px] text-faint">
      {children}
    </div>
  );
}

function fmtCount(n: number): string {
  if (n >= 10000) return Math.round(n / 1000) + "k";
  return n.toLocaleString("en-US");
}

// Radio facets carry only an ISO 3166-1 alpha-2 code (no precomputed flag like
// the TV catalog), so derive the regional-indicator emoji from the code.
function flagFromCode(code: string): string {
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "🏳️";
  return String.fromCodePoint(...[...cc].map((ch) => 127397 + ch.charCodeAt(0)));
}

function LibrarySidebar() {
  const view = usePlayer((s) => s.libraryView);
  const setView = usePlayer((s) => s.setLibraryView);
  const enabled = isTauri();

  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState("");
  const [groupsOpen, setGroupsOpen] = useState(() => localStorage.getItem("mc.lib.groupsOpen") !== "0");
  const toggleGroups = () => {
    const v = !groupsOpen;
    setGroupsOpen(v);
    localStorage.setItem("mc.lib.groupsOpen", v ? "1" : "0");
  };

  const folders = useQuery({ queryKey: ["lib", "folders"], queryFn: api.libraryFolders, enabled });
  const playlists = useQuery({ queryKey: ["lib", "playlists"], queryFn: api.libraryPlaylists, enabled });

  const isSel = (v: LibraryView) => {
    if (v.view !== view.view) return false;
    if (v.view === "browse") return "kind" in view && v.kind === view.kind;
    return "value" in v ? "value" in view && v.value === view.value : true;
  };

  const Item = ({ v, label, count, dot }: { v: LibraryView; label: string; count?: number; dot?: string }) => (
    <button
      onClick={() => setView(v)}
      className={clsx(
        "flex items-center gap-[9px] rounded-[7px] px-[9px] py-[6px] text-left text-[12.5px] transition-colors",
        isSel(v) ? "border border-green-bd bg-green-bg font-medium text-text" : "border border-transparent text-dim hover:bg-hover hover:text-text"
      )}
    >
      {dot ? <span className="h-[9px] w-[9px] flex-none rounded-[3px]" style={{ background: dot }} /> : null}
      <span className="min-w-0 truncate">{label}</span>
      {count != null && <span className="ml-auto text-[10.5px] text-faint">{fmtCount(count)}</span>}
    </button>
  );

  return (
    <>
      <button
        onClick={toggleGroups}
        className="flex w-full items-center gap-[5px] px-2 pb-1 pt-[10px] text-[10.5px] font-bold tracking-[.8px] text-faint transition-colors hover:text-dim"
      >
        <span className="grid w-[10px] place-items-center text-[8px]">{groupsOpen ? "▼" : "▶"}</span>
        <span>GROUPS</span>
        {folders.data?.length ? (
          <span className="ml-auto font-medium text-faint">{folders.data.length}</span>
        ) : null}
      </button>
      {groupsOpen && (
        <div className="max-h-[220px] overflow-auto">
          {folders.data?.map((f) => (
            <div key={f.id} className="group flex items-center">
          <button
            onClick={() => setView({ view: "group", value: String(f.id) })}
            className={clsx(
              "flex flex-1 items-center gap-[9px] rounded-[7px] px-[9px] py-[6px] text-left text-[12.5px] transition-colors",
              isSel({ view: "group", value: String(f.id) })
                ? "border border-green-bd bg-green-bg font-medium text-text"
                : "border border-transparent text-dim hover:bg-hover hover:text-text"
            )}
          >
            <span className="h-[9px] w-[9px] flex-none rounded-[3px]" style={{ background: f.color }} />
            <span className="min-w-0 truncate">{f.label}</span>
          </button>
          <button
            onClick={async () => {
              await api.libraryRemoveFolder(f.id);
              if (view.view === "group" && view.value === String(f.id)) setView({ view: "all" });
              qc.invalidateQueries({ queryKey: ["lib"] });
            }}
            className="ml-1 hidden h-6 w-6 place-items-center rounded text-faint hover:text-red group-hover:grid"
            aria-label="Remove folder"
            title="Remove this folder from the library (your files are not deleted)"
          >
            <XIcon size={13} />
          </button>
        </div>
      ))}
        </div>
      )}

      <GroupLabel>BROWSE</GroupLabel>
      <Item v={{ view: "browse", kind: "artists" }} label="Artists" />
      <Item v={{ view: "browse", kind: "albums" }} label="Albums" />
      <Item v={{ view: "browse", kind: "genres" }} label="Genres" />

      <GroupLabel>LIBRARY</GroupLabel>
      <Item v={{ view: "all" }} label="All Songs" />
      <Item v={{ view: "recent" }} label="Recently Added" />

      <GroupLabel>PLAYLISTS</GroupLabel>
      {playlists.data?.map((p) =>
        renamingId === p.id ? (
          <input
            key={p.id}
            autoFocus
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            onBlur={() => setRenamingId(null)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && renameText.trim()) {
                await api.playlistRename(p.id, renameText.trim());
                setRenamingId(null);
                qc.invalidateQueries({ queryKey: ["lib", "playlists"] });
              } else if (e.key === "Escape") setRenamingId(null);
            }}
            className="rounded-[7px] border border-border-strong bg-elev px-[9px] py-[6px] text-[12.5px] text-text outline-none"
          />
        ) : (
          <div key={p.id} className="group flex items-center">
            <button
              onClick={() => setView({ view: "playlist", value: String(p.id) })}
              onDoubleClick={() => {
                setRenamingId(p.id);
                setRenameText(p.name);
              }}
              className={clsx(
                "flex flex-1 items-center gap-[9px] rounded-[7px] px-[9px] py-[6px] text-left text-[12.5px] transition-colors",
                isSel({ view: "playlist", value: String(p.id) })
                  ? "border border-green-bd bg-green-bg font-medium text-text"
                  : "border border-transparent text-dim hover:bg-hover hover:text-text"
              )}
            >
              <span className="min-w-0 truncate">{p.name}</span>
              <span className="ml-auto text-[10.5px] text-faint">{fmtCount(p.count)}</span>
            </button>
            <button
              onClick={async () => {
                await api.playlistDelete(p.id);
                qc.invalidateQueries({ queryKey: ["lib", "playlists"] });
              }}
              className="ml-1 hidden h-6 w-6 place-items-center rounded text-faint hover:text-red group-hover:grid"
              aria-label="Delete playlist"
              title="Delete playlist"
            >
              <XIcon size={13} />
            </button>
          </div>
        )
      )}
      {creating ? (
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onBlur={() => {
            setCreating(false);
            setNewName("");
          }}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && newName.trim()) {
              await api.playlistCreate(newName.trim());
              setCreating(false);
              setNewName("");
              qc.invalidateQueries({ queryKey: ["lib", "playlists"] });
            } else if (e.key === "Escape") {
              setCreating(false);
              setNewName("");
            }
          }}
          placeholder="Playlist name…"
          className="rounded-[7px] border border-border-strong bg-elev px-[9px] py-[6px] text-[12.5px] text-text outline-none placeholder:text-faint"
        />
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-[9px] rounded-[7px] px-[9px] py-[6px] text-left text-[12.5px] text-faint transition-colors hover:bg-hover hover:text-text"
        >
          <span className="w-[13px] text-center">＋</span> New playlist…
        </button>
      )}
    </>
  );
}

function RadioSidebar() {
  const radioTag = usePlayer((s) => s.radioTag);
  const radioCountry = usePlayer((s) => s.radioCountry);
  const setRadioTag = usePlayer((s) => s.setRadioTag);
  const setRadioCountry = usePlayer((s) => s.setRadioCountry);

  // radio-browser facets: top genres + countries with station counts. Fetched
  // once and shared (react-query dedupes if RadioMode reads it too).
  const facets = useQuery({
    queryKey: ["radio-facets"],
    queryFn: () => api.radioFacets(),
    enabled: isTauri(),
    staleTime: Infinity,
  });

  const tags = facets.data?.tags.slice(0, 40) ?? [];
  const countries = facets.data?.countries ?? [];

  return (
    <>
      <GroupLabel>GENRES</GroupLabel>
      {tags.map((t) => {
        const sel = radioTag === t.name;
        return (
          <button
            key={t.name}
            onClick={() => setRadioTag(t.name)}
            className={clsx(
              "flex items-center gap-[9px] rounded-[7px] px-[9px] py-[6px] text-left text-[12.5px] transition-colors",
              sel ? "font-medium text-text" : "text-dim hover:bg-hover hover:text-text"
            )}
          >
            <span className={clsx("w-[14px] text-center", sel ? "text-green" : "text-faint")}>
              {sel ? "✓" : ""}
            </span>
            <span className="min-w-0 truncate capitalize">{t.name}</span>
            <span className="ml-auto text-[10.5px] text-faint">{fmtCount(t.count)}</span>
          </button>
        );
      })}

      <GroupLabel>COUNTRY</GroupLabel>
      {countries.map((c) => {
        const sel = radioCountry === c.name;
        return (
          <button
            key={c.code || c.name}
            onClick={() => setRadioCountry(c.name)}
            className={clsx(
              "flex items-center gap-[9px] rounded-[7px] px-[9px] py-[6px] text-left text-[12.5px] transition-colors",
              sel ? "font-medium text-text" : "text-dim hover:bg-hover hover:text-text"
            )}
          >
            <span className="text-[14px] leading-none">{flagFromCode(c.code)}</span>
            <span className="min-w-0 truncate">{c.name}</span>
            <span className="ml-auto text-[10.5px] text-faint">{fmtCount(c.count)}</span>
          </button>
        );
      })}
    </>
  );
}

export function Sidebar({
  facets,
  totalChannels,
  favCount,
}: {
  facets: Facets | undefined;
  totalChannels: number | null;
  favCount: number;
}) {
  const mode = usePlayer((s) => s.mode);
  const setMode = usePlayer((s) => s.setMode);
  const radioCount = usePlayer((s) => s.radioCount);
  const youtubeCount = usePlayer((s) => s.youtubeCount);
  const categories = usePlayer((s) => s.categories);
  const countries = usePlayer((s) => s.countries);
  const favoritesOnly = usePlayer((s) => s.favoritesOnly);
  const toggleCategory = usePlayer((s) => s.toggleCategory);
  const toggleCountry = usePlayer((s) => s.toggleCountry);
  const setFavoritesOnly = usePlayer((s) => s.setFavoritesOnly);

  // Whole-directory station total for the "Radio" source badge (like Live TV's
  // total channel count) — stable, independent of the selected genre/country.
  // Shares the cached facets query with RadioSidebar.
  const radioFacets = useQuery({
    queryKey: ["radio-facets"],
    queryFn: () => api.radioFacets(),
    enabled: isTauri(),
    staleTime: Infinity,
  });

  const sources = [
    {
      id: "tv" as const,
      label: "Live TV",
      icon: <TvIcon size={15} />,
      count: totalChannels,
    },
    { id: "radio" as const, label: "Radio", icon: <RadioIcon size={15} />, count: radioFacets.data?.total ?? radioCount },
    { id: "youtube" as const, label: "YouTube", icon: <YouTubeIcon size={15} />, count: youtubeCount },
    { id: "library" as const, label: "My Music", icon: <MusicIcon size={15} />, count: null },
  ];

  return (
    <aside className="flex w-[212px] flex-none flex-col gap-[6px] overflow-auto border-r border-border bg-sidebar px-[10px] py-3">
      <GroupLabel>SOURCES</GroupLabel>
      {sources.map((s) => {
        const active = mode === s.id;
        return (
          <button
            key={s.id}
            onClick={() => setMode(s.id)}
            className={clsx(
              "flex items-center gap-[10px] rounded-lg px-[9px] py-2 text-left font-medium transition-colors",
              active ? "bg-surface2 text-text" : "text-dim hover:bg-hover hover:text-text"
            )}
          >
            <span className={clsx("grid w-4 place-items-center", active ? "text-green" : "text-dim")}>
              {s.icon}
            </span>
            {s.label}
            {s.count != null && (
              <span
                className={clsx(
                  "ml-auto rounded-[10px] px-[7px] py-px text-[11px]",
                  active ? "bg-active text-dim" : "bg-surface2 text-faint"
                )}
              >
                {fmtCount(s.count)}
              </span>
            )}
          </button>
        );
      })}

      {mode === "tv" && (
        <>
          <GroupLabel>CATEGORIES</GroupLabel>
          {facets?.categories.map((c) => {
            const sel = categories.includes(c.name);
            return (
              <button
                key={c.name}
                onClick={() => toggleCategory(c.name)}
                className={clsx(
                  "flex items-center gap-[9px] rounded-[7px] px-[9px] py-[6px] text-left text-[12.5px] transition-colors",
                  sel ? "font-medium text-text" : "text-dim hover:bg-hover hover:text-text"
                )}
              >
                <span className={clsx("w-[14px] text-center", sel ? "text-green" : "text-faint")}>
                  {sel ? "✓" : ""}
                </span>
                <span className="min-w-0 truncate">{c.name}</span>
                <span className="ml-auto text-[10.5px] text-faint">{fmtCount(c.count)}</span>
              </button>
            );
          })}

          <GroupLabel>COUNTRY</GroupLabel>
          {facets?.countries.map((c) => {
            const sel = countries.includes(c.code);
            return (
              <button
                key={c.code}
                onClick={() => toggleCountry(c.code)}
                className={clsx(
                  "flex items-center gap-[9px] rounded-[7px] px-[9px] py-[6px] text-left text-[12.5px] transition-colors",
                  sel ? "font-medium text-text" : "text-dim hover:bg-hover hover:text-text"
                )}
              >
                <span className="text-[14px] leading-none">{c.flag || "🏳️"}</span>
                <span className="min-w-0 truncate">{c.name}</span>
                <span className="ml-auto text-[10.5px] text-faint">{fmtCount(c.count)}</span>
              </button>
            );
          })}

          <GroupLabel>FAVORITES</GroupLabel>
          <button
            onClick={() => setFavoritesOnly(!favoritesOnly)}
            className={clsx(
              "flex items-center gap-[9px] rounded-[7px] px-[9px] py-[6px] text-left text-[12.5px] transition-colors",
              favoritesOnly ? "font-medium text-text" : "text-dim hover:bg-hover hover:text-text"
            )}
          >
            <span className="text-[14px] leading-none text-green">★</span>
            <span className="min-w-0 truncate">My Channels</span>
            <span className="ml-auto text-[10.5px] text-faint">{favCount}</span>
          </button>
        </>
      )}

      {mode === "radio" && <RadioSidebar />}

      {mode === "library" && <LibrarySidebar />}
    </aside>
  );
}
