import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { isTauri } from "../lib/os";
import { Deduper } from "../lib/ytDedupe";
import type { SourceRef } from "../lib/ytCollections";
import type { YoutubeItem, YoutubeResults } from "../api/types";

export interface MergedSources {
  mergedItems: YoutubeItem[];
  loading: boolean;
  removed: number;
  errors: Record<string, string>;
}

// Stream every source playlist page-by-page (no 50-cap), de-duping as pages
// arrive, accumulating into one merged list. The first page of each source
// paints immediately; the rest fills in the background. Re-runs whenever the set
// of source playlistIds changes; an epoch ref cancels an in-flight run when that
// happens so stale pages never leak into the new merge.
export function useMergedSources(sources: SourceRef[]): MergedSources {
  const qc = useQueryClient();
  const [mergedItems, setMergedItems] = useState<YoutubeItem[]>([]);
  const [removed, setRemoved] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Stable signature: the ordered playlistIds. Title changes don't re-fetch.
  const sig = sources.map((s) => s.playlistId).join("|");

  useEffect(() => {
    if (!isTauri() || sources.length === 0) {
      setMergedItems([]);
      setRemoved(0);
      setLoading(false);
      setErrors({});
      return;
    }
    let cancelled = false;
    const dedup = new Deduper();
    let dropped = 0;
    const errs: Record<string, string> = {};
    setMergedItems([]);
    setRemoved(0);
    setErrors({});
    setLoading(true);

    (async () => {
      for (const src of sources) {
        let token: string | undefined = undefined;
        do {
          if (cancelled) return;
          const pageToken = token; // snapshot so the queryFn closure isn't self-referential
          try {
            const res: YoutubeResults = await qc.fetchQuery<YoutubeResults>({
              queryKey: ["yt-pl-page", src.playlistId, pageToken ?? ""],
              queryFn: () => api.youtubePlaylist(src.playlistId, pageToken),
              staleTime: 5 * 60 * 1000,
            });
            if (cancelled) return;
            const fresh: YoutubeItem[] = [];
            for (const it of res.items) {
              if (dedup.add(it)) fresh.push(it);
              else dropped += 1;
            }
            if (fresh.length) setMergedItems((prev) => [...prev, ...fresh]);
            setRemoved(dropped);
            token = res.nextPageToken ?? undefined;
          } catch (e) {
            errs[src.playlistId] = e instanceof Error ? e.message : String(e);
            setErrors({ ...errs });
            token = undefined; // give up on this source, keep the others
          }
        } while (token);
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return { mergedItems, loading, removed, errors };
}
