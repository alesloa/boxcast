import { usePlayer } from "../store/player";
import { SearchIcon } from "../lib/icons";

export function Toolbar({
  count,
  noun = "channels",
  placeholder = "Search channels…",
}: {
  count: number;
  noun?: string;
  placeholder?: string;
}) {
  const search = usePlayer((s) => s.search);
  const setSearch = usePlayer((s) => s.setSearch);

  return (
    <div className="flex h-[52px] flex-none items-center gap-3 border-b border-border px-4">
      <div className="text-[13px] text-dim">
        <b className="font-[650] text-text">{count.toLocaleString("en-US")}</b> {noun}
      </div>
      <div className="flex flex-1 items-center gap-[9px] rounded-[9px] border border-border bg-elev px-3 py-2 text-dim focus-within:border-border-strong">
        <SearchIcon size={15} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
        />
      </div>
    </div>
  );
}
