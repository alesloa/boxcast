// YouTube "Saved" groups: a thin organization layer over saved-song favorites.
// The favorites themselves stay durable in SQLite; this only records which named
// group each saved videoId belongs to, plus the set of group names (so an empty
// group still persists). Kept in localStorage — losing it only un-files songs
// into the default group, it never loses the favorites.
//
// The default group is implicit: any saved song with no assignment (or assigned
// to a name that no longer exists) belongs to DEFAULT_GROUP. It is always shown
// on top; named groups render below it in alphabetical order.

export const DEFAULT_GROUP = "Unsorted";

export interface YtFavGroups {
  /** User-named groups (never includes the implicit default), creation order. */
  groups: string[];
  /** videoId -> group name. Absent = default group. */
  assign: Record<string, string>;
}

const KEY = "mc.yt.favGroups";

export function loadYtGroups(): YtFavGroups {
  try {
    const v = localStorage.getItem(KEY);
    if (!v) return { groups: [], assign: {} };
    const p = JSON.parse(v) as Partial<YtFavGroups>;
    return { groups: p.groups ?? [], assign: p.assign ?? {} };
  } catch {
    return { groups: [], assign: {} };
  }
}

export function saveYtGroups(g: YtFavGroups): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* quota / serialization — best effort */
  }
}

/** The group a video belongs to, or DEFAULT_GROUP if unfiled / stale. */
export function groupOf(g: YtFavGroups, videoId: string): string {
  const name = g.assign[videoId];
  return name && g.groups.includes(name) ? name : DEFAULT_GROUP;
}

/**
 * Create a group from raw user text. No-op for blank input or the reserved
 * default name; de-dupes case-insensitively. Returns the next state and the
 * canonical name actually present (so the caller can assign a song to it), or
 * null if nothing was created.
 */
export function createGroup(
  g: YtFavGroups,
  raw: string
): { next: YtFavGroups; name: string | null } {
  const name = raw.trim();
  if (!name || name.toLowerCase() === DEFAULT_GROUP.toLowerCase()) return { next: g, name: null };
  const existing = g.groups.find((x) => x.toLowerCase() === name.toLowerCase());
  if (existing) return { next: g, name: existing };
  return { next: { ...g, groups: [...g.groups, name] }, name };
}

/** Assign a video to a group; DEFAULT_GROUP or an unknown name un-files it. */
export function assignToGroup(g: YtFavGroups, videoId: string, group: string): YtFavGroups {
  const assign = { ...g.assign };
  if (group === DEFAULT_GROUP || !g.groups.includes(group)) delete assign[videoId];
  else assign[videoId] = group;
  return { ...g, assign };
}

/** Rename a group, merging into an existing same-name group if one exists. */
export function renameGroup(g: YtFavGroups, from: string, raw: string): YtFavGroups {
  const to = raw.trim();
  if (!to || from === to || to.toLowerCase() === DEFAULT_GROUP.toLowerCase()) return g;
  const groups = g.groups.filter((x) => x !== from);
  const canonical = groups.find((x) => x.toLowerCase() === to.toLowerCase()) ?? to;
  if (!groups.includes(canonical)) groups.push(canonical);
  const assign: Record<string, string> = {};
  for (const [vid, grp] of Object.entries(g.assign)) assign[vid] = grp === from ? canonical : grp;
  return { groups, assign };
}

/** Delete a group; its songs fall back to the default group (favorites kept). */
export function deleteGroup(g: YtFavGroups, name: string): YtFavGroups {
  const groups = g.groups.filter((x) => x !== name);
  const assign: Record<string, string> = {};
  for (const [vid, grp] of Object.entries(g.assign)) if (grp !== name) assign[vid] = grp;
  return { groups, assign };
}

/** Render order: default group first, then named groups alphabetically. */
export function orderedGroups(g: YtFavGroups): string[] {
  const named = [...g.groups].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  return [DEFAULT_GROUP, ...named];
}

/** Drop assignments for videos that are no longer saved. Returns g if unchanged. */
export function prune(g: YtFavGroups, validIds: Set<string>): YtFavGroups {
  let changed = false;
  const assign: Record<string, string> = {};
  for (const [vid, grp] of Object.entries(g.assign)) {
    if (validIds.has(vid)) assign[vid] = grp;
    else changed = true;
  }
  return changed ? { ...g, assign } : g;
}
