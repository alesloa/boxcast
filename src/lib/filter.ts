import type { Channel } from "../api/types";

export function qualityHeight(q: string | null): number {
  if (!q) return 0;
  const m = q.match(/(\d{3,4})\s*p?/i);
  return m ? parseInt(m[1], 10) : 0;
}

export function isHD(c: Channel): boolean {
  return c.streams.some((s) => qualityHeight(s.quality) >= 720);
}

export interface FilterState {
  search: string;
  categories: string[];
  countries: string[];
  languages: string[];
  hdOnly: boolean;
  favoritesOnly: boolean;
  favorites: Set<string>;
}

export function filterChannels(channels: Channel[], f: FilterState): Channel[] {
  const q = f.search.trim().toLowerCase();
  return channels.filter((c) => {
    if (f.favoritesOnly && !f.favorites.has(c.id)) return false;
    if (f.categories.length && !c.categories.some((cat) => f.categories.includes(cat)))
      return false;
    if (f.countries.length && !(c.country && f.countries.includes(c.country.code)))
      return false;
    if (f.languages.length && !c.languages.some((l) => f.languages.includes(l))) return false;
    if (f.hdOnly && !isHD(c)) return false;
    if (q) {
      // Match name, categories/genres, country, and language so typing
      // "movies", "news", a country, etc. filters live as you type.
      const hay = [
        c.name,
        ...c.categories,
        c.country?.name ?? "",
        ...c.languages,
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
