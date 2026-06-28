import clsx from "clsx";
import { usePlayer } from "../store/player";
import type { Facets } from "../api/types";

function Chip({
  dot,
  children,
  onRemove,
  onClick,
  on,
}: {
  dot?: string;
  children: React.ReactNode;
  onRemove?: () => void;
  onClick?: () => void;
  on?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        "flex cursor-pointer items-center gap-[7px] rounded-[20px] border px-3 py-[5px] text-[12px] font-medium transition-colors",
        on
          ? "border-green-bd bg-green-bg text-[var(--c-green-text)]"
          : "border-border bg-elev text-dim hover:bg-hover hover:text-text"
      )}
    >
      {dot && <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot }} />}
      {children}
      {onRemove && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-px text-[14px] leading-none text-faint hover:text-text"
        >
          ✕
        </span>
      )}
    </div>
  );
}

export function FilterChips({ facets }: { facets: Facets | undefined }) {
  const categories = usePlayer((s) => s.categories);
  const countries = usePlayer((s) => s.countries);
  const languages = usePlayer((s) => s.languages);
  const hdOnly = usePlayer((s) => s.hdOnly);
  const favoritesOnly = usePlayer((s) => s.favoritesOnly);
  const toggleCategory = usePlayer((s) => s.toggleCategory);
  const toggleCountry = usePlayer((s) => s.toggleCountry);
  const toggleLanguage = usePlayer((s) => s.toggleLanguage);
  const setHdOnly = usePlayer((s) => s.setHdOnly);
  const setFavoritesOnly = usePlayer((s) => s.setFavoritesOnly);
  const clearFilters = usePlayer((s) => s.clearFilters);

  const countryOf = (code: string) => facets?.countries.find((c) => c.code === code);

  const anyActive =
    categories.length > 0 ||
    countries.length > 0 ||
    languages.length > 0 ||
    hdOnly ||
    favoritesOnly;

  return (
    <div className="flex flex-wrap gap-2 border-b border-border px-4 pb-2 pt-3">
      {categories.map((name) => (
        <Chip key={"cat-" + name} dot="var(--c-green)" on onRemove={() => toggleCategory(name)}>
          {name}
        </Chip>
      ))}
      {countries.map((code) => {
        const c = countryOf(code);
        return (
          <Chip key={"co-" + code} dot="#549bff" on onRemove={() => toggleCountry(code)}>
            {c?.flag} {c?.name ?? code}
          </Chip>
        );
      })}
      {languages.map((name) => (
        <Chip key={"lang-" + name} dot="#b07cff" on onRemove={() => toggleLanguage(name)}>
          {name}
        </Chip>
      ))}
      {favoritesOnly && (
        <Chip dot="var(--c-green)" on onRemove={() => setFavoritesOnly(false)}>
          ★ My Channels
        </Chip>
      )}

      <Chip dot="#e3b341" on={hdOnly} onClick={() => setHdOnly(!hdOnly)}>
        HD only
      </Chip>

      {anyActive && (
        <div
          onClick={clearFilters}
          className="flex cursor-pointer items-center px-3 py-[5px] text-[12px] font-medium text-faint hover:text-text"
        >
          Clear all
        </div>
      )}
    </div>
  );
}
