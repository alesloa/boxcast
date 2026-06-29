import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import type { Channel } from "../api/types";
import { Logo } from "./Logo";
import { SearchIcon, StarIcon, PlayIcon } from "../lib/icons";
import { usePlayer } from "../store/player";
import { ContextMenu, type MenuItem } from "./ContextMenu";

function EqBars() {
  return (
    <div className="flex h-[14px] items-end gap-[2px]">
      <i className="w-[3px] origin-bottom animate-eq rounded-[2px] bg-green" style={{ height: 6 }} />
      <i className="w-[3px] origin-bottom animate-eq rounded-[2px] bg-green" style={{ height: 13, animationDelay: ".2s" }} />
      <i className="w-[3px] origin-bottom animate-eq rounded-[2px] bg-green" style={{ height: 9, animationDelay: ".4s" }} />
    </div>
  );
}

function bestQuality(c: Channel): string | null {
  for (const s of c.streams) if (s.quality) return s.quality;
  return null;
}

export function ChannelList({
  channels,
  favorites,
  onToggleFav,
}: {
  channels: Channel[];
  favorites: Set<string>;
  onToggleFav: (c: Channel) => void;
}) {
  const current = usePlayer((s) => s.current);
  const playChannel = usePlayer((s) => s.playChannel);
  const search = usePlayer((s) => s.search);
  const setSearch = usePlayer((s) => s.setSearch);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = useVirtualizer({
    count: channels.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 58,
    overscan: 12,
  });

  // Keep the playing channel in view: scroll the virtual list to it when the
  // current channel changes (next/prev/auto-advance). "auto" only scrolls when
  // it's off screen.
  useEffect(() => {
    if (!current) return;
    const idx = channels.findIndex((c) => c.id === current.id);
    if (idx >= 0) rows.scrollToIndex(idx, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, channels]);

  return (
    <div className="flex min-h-0 w-[330px] flex-none flex-col border-l border-border">
      <div className="flex flex-col gap-[8px] border-b border-border px-[12px] pb-[10px] pt-3">
        <div className="flex items-center justify-between text-[11px] font-bold tracking-[.6px] text-faint">
          <span>CHANNELS</span>
          <span className="font-medium text-faint">
            {channels.length.toLocaleString("en-US")} · A–Z
          </span>
        </div>
        <div className="flex items-center gap-[8px] rounded-[8px] border border-border bg-elev px-[9px] py-[6px] text-dim focus-within:border-border-strong">
          <SearchIcon size={14} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter channels…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-faint"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear filter"
              className="text-[13px] leading-none text-faint hover:text-text"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div ref={parentRef} className="flex-1 overflow-auto px-[10px] pb-[14px] pt-[6px]">
        {channels.length === 0 ? (
          <div className="px-2 pt-10 text-center text-[12.5px] text-faint">No channels match these filters.</div>
        ) : (
          <div style={{ height: rows.getTotalSize(), position: "relative", width: "100%" }}>
            {rows.getVirtualItems().map((vi) => {
              const c = channels[vi.index];
              const isPlaying = current?.id === c.id;
              const isFav = favorites.has(c.id);
              const q = bestQuality(c);
              return (
                <div
                  key={c.id}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${vi.start}px)`, height: vi.size, paddingBottom: 4 }}
                >
                  <div
                    onClick={() => playChannel(c)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({
                        x: e.clientX,
                        y: e.clientY,
                        items: [
                          { icon: <PlayIcon size={12} />, label: "Play", onClick: () => playChannel(c) },
                          {
                            icon: <StarIcon size={14} filled={isFav} />,
                            label: isFav ? "Remove from favorites" : "Add to favorites",
                            onClick: () => onToggleFav(c),
                          },
                        ],
                      });
                    }}
                    className={clsx(
                      "group flex cursor-pointer items-center gap-[11px] rounded-[9px] px-[10px] py-[9px]",
                      isPlaying
                        ? "border border-green-bd bg-green-bg"
                        : "border border-transparent hover:bg-hover"
                    )}
                  >
                    <Logo src={c.logo} name={c.name} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{c.name}</div>
                      <div className="mt-px flex items-center gap-[7px] text-[11.5px] text-faint">
                        {c.country?.flag && <span className="text-[12px]">{c.country.flag}</span>}
                        <span className="truncate">
                          {[c.categories[0], q].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                    </div>
                    {isPlaying ? (
                      <EqBars />
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFav(c);
                        }}
                        aria-label={isFav ? "Remove favorite" : "Add favorite"}
                        title={isFav ? "Remove from favorites" : "Save to favorites"}
                        className={clsx(
                          "transition-opacity",
                          isFav
                            ? "text-green opacity-100"
                            : "text-faint opacity-0 hover:text-text group-hover:opacity-100"
                        )}
                      >
                        <StarIcon size={16} filled={isFav} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
