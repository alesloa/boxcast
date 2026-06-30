// Named multi-playlist "collections". A collection stores only its source
// playlist IDs (+ a friendly title each) and the videoIds the user removed from
// it — NOT the songs. Opening it re-fetches + re-merges live. Kept in
// localStorage; losing it only forgets the grouping, never any favorite or list.

export interface SourceRef {
  playlistId: string;
  title: string;
}

export interface Collection {
  id: string;
  name: string;
  sources: SourceRef[];
  removedIds: string[];
  createdAt: number;
  updatedAt: number;
}

const KEY = "mc.yt.collections";

export function loadCollections(): Collection[] {
  try {
    const v = localStorage.getItem(KEY);
    if (!v) return [];
    const p = JSON.parse(v) as Collection[];
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export function saveCollections(list: Collection[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota / serialization — best effort */
  }
}

export function getCollection(list: Collection[], id: string): Collection | null {
  return list.find((c) => c.id === id) ?? null;
}

/** Create a collection from a name + the sources currently merged. Skips blanks. */
export function createCollection(
  list: Collection[],
  rawName: string,
  sources: SourceRef[]
): { next: Collection[]; created: Collection | null } {
  const name = rawName.trim();
  if (!name || sources.length === 0) return { next: list, created: null };
  const now = Date.now();
  const created: Collection = {
    id: crypto.randomUUID(),
    name,
    sources: dedupeSources(sources),
    removedIds: [],
    createdAt: now,
    updatedAt: now,
  };
  return { next: [created, ...list], created };
}

export function renameCollection(list: Collection[], id: string, rawName: string): Collection[] {
  const name = rawName.trim();
  if (!name) return list;
  return list.map((c) => (c.id === id ? { ...c, name, updatedAt: Date.now() } : c));
}

export function deleteCollection(list: Collection[], id: string): Collection[] {
  return list.filter((c) => c.id !== id);
}

/** Append a source playlist to a collection (ignores a playlist already present). */
export function addSource(list: Collection[], id: string, src: SourceRef): Collection[] {
  return list.map((c) =>
    c.id === id && !c.sources.some((s) => s.playlistId === src.playlistId)
      ? { ...c, sources: [...c.sources, src], updatedAt: Date.now() }
      : c
  );
}

export function removeSource(list: Collection[], id: string, playlistId: string): Collection[] {
  return list.map((c) =>
    c.id === id
      ? { ...c, sources: c.sources.filter((s) => s.playlistId !== playlistId), updatedAt: Date.now() }
      : c
  );
}

/** Toggle a videoId in a collection's removed set (the per-song ✕ "organize"). */
export function setSongRemoved(
  list: Collection[],
  id: string,
  videoId: string,
  removed: boolean
): Collection[] {
  return list.map((c) => {
    if (c.id !== id) return c;
    const has = c.removedIds.includes(videoId);
    if (removed === has) return c;
    const removedIds = removed
      ? [...c.removedIds, videoId]
      : c.removedIds.filter((v) => v !== videoId);
    return { ...c, removedIds, updatedAt: Date.now() };
  });
}

/** Drop duplicate source playlists, keeping first occurrence + order. */
export function dedupeSources(sources: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const s of sources) {
    if (seen.has(s.playlistId)) continue;
    seen.add(s.playlistId);
    out.push(s);
  }
  return out;
}
