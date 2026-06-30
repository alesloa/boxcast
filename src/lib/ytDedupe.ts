// Pure de-duplication for merged YouTube playlists. A song is a duplicate if its
// videoId was already seen, OR its normalized "title + artist" key was already
// seen. First occurrence wins. Stateful via Sets so merging stays O(1) per song,
// no slowdown as the merged list grows.

import type { YoutubeItem } from "../api/types";

// Noise tokens stripped before comparing titles/channels, so the same song with
// cosmetic differences ("(Official Video)", "[HD]", "- Topic") collapses to one.
const NOISE = [
  /\(official\s*(music)?\s*(video|audio|visualizer|lyric|lyrics)\)/g,
  /\[(official\s*)?(video|audio|hd|4k|mv|m\/v|lyrics?)\]/g,
  /\((lyric|lyrics|visualizer|audio|hd|4k|mv)\)/g,
  /\bofficial\s+(music\s+)?video\b/g,
  /\s-\s*topic\b/g,
  /\bfeat\.?\b|\bft\.?\b/g,
];

export function normalizeKey(title: string, channelTitle: string): string {
  const clean = (s: string) => {
    let out = (s || "").toLowerCase();
    for (const re of NOISE) out = out.replace(re, " ");
    return out.replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  };
  return `${clean(title)} ${clean(channelTitle)}`;
}

export class Deduper {
  private ids = new Set<string>();
  private keys = new Set<string>();

  /** Add an item. Returns true if new (keep it), false if a duplicate (drop it). */
  add(item: YoutubeItem): boolean {
    if (this.ids.has(item.videoId)) return false;
    const key = normalizeKey(item.title, item.channelTitle);
    if (this.keys.has(key)) {
      this.ids.add(item.videoId); // remember the id too, so its exact dupes also drop
      return false;
    }
    this.ids.add(item.videoId);
    this.keys.add(key);
    return true;
  }

  get size(): number {
    return this.keys.size;
  }
}
