import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Decode an audio file in the webview (Web Audio) and downsample channel 0 into
 * `buckets` peak amplitudes for drawing a waveform. Decode is one-off on open and
 * is display-only — playback uses the original file, not this buffer.
 */
export function useAudioPeaks(path: string, buckets = 1000) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(convertFileSrc(path));
        const raw = await res.arrayBuffer();
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const audio = await ctx.decodeAudioData(raw);
        const ch = audio.getChannelData(0);
        const block = Math.max(1, Math.floor(ch.length / buckets));
        const out: number[] = [];
        for (let i = 0; i < buckets; i++) {
          let max = 0;
          const start = i * block;
          for (let j = 0; j < block && start + j < ch.length; j++) {
            const v = Math.abs(ch[start + j]);
            if (v > max) max = v;
          }
          out.push(max);
        }
        await ctx.close();
        if (!cancelled) {
          setPeaks(out);
          setDuration(audio.duration);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setPeaks([]);
          setDuration(0);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, buckets]);

  return { peaks, duration, loading };
}
