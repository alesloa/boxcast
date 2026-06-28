import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { isTauri } from "../lib/os";
import type { Channel, Favorite, Source } from "../api/types";

export interface FavItem {
  ref: string;
  name: string;
  logo?: string | null;
  /** Full source item (Station / YoutubeItem / …) serialized for replay. */
  meta?: unknown;
}

export function useFavorites(source: Source) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["favorites"],
    queryFn: () => api.favoritesList(),
    enabled: isTauri(),
    staleTime: Infinity,
  });

  // Favorites of this source, newest first.
  const items: Favorite[] = useMemo(
    () =>
      (data ?? [])
        .filter((f) => f.source === source)
        .sort((a, b) => b.createdAt - a.createdAt),
    [data, source]
  );

  const refs = useMemo(() => new Set(items.map((f) => f.ref)), [items]);

  const add = useMutation({
    mutationFn: api.favoritesAdd,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });
  const remove = useMutation({
    mutationFn: ({ source, ref }: { source: Source; ref: string }) =>
      api.favoritesRemove(source, ref),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });

  const isFav = (ref: string) => refs.has(ref);

  /** Toggle any item for this hook's source; `meta` is round-tripped via JSON. */
  const toggle = (item: FavItem) => {
    if (refs.has(item.ref)) {
      remove.mutate({ source, ref: item.ref });
    } else {
      add.mutate({
        source,
        ref: item.ref,
        name: item.name,
        logo: item.logo ?? null,
        metaJson: item.meta == null ? null : JSON.stringify(item.meta),
      });
    }
  };

  const toggleChannel = (c: Channel) =>
    toggle({ ref: c.id, name: c.name, logo: c.logo ?? null });

  return { refs, items, count: refs.size, isFav, toggle, toggleChannel, add, remove };
}

/** Parse a favorite's `metaJson` back into its original source item, or null. */
export function favMeta<T>(f: Favorite): T | null {
  if (!f.metaJson) return null;
  try {
    return JSON.parse(f.metaJson) as T;
  } catch {
    return null;
  }
}
