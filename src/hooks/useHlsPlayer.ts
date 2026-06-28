import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { RefObject } from "react";
import { usePlayer } from "../store/player";
import { proxiedUrl } from "../api/client";

export type PlayerStatus = "idle" | "loading" | "playing" | "error";

// Heuristic: does this string look like a human-readable program title (and not
// a timestamp, URL, or numeric token from stream metadata)?
function looksTitle(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 140) return false;
  if (/^https?:\/\//i.test(t)) return false;
  if (/^[\d.:_-]+$/.test(t)) return false;
  return /[a-z]/i.test(t);
}

// Pull a title out of an in-band (ID3) metadata cue. Prefers the ID3 title
// frame (TIT2/TITLE); accepts other text frames only if they look like a title.
function cueTitle(cue: any): string | null {
  const v = cue?.value;
  if (v && typeof v === "object") {
    const key: string = v.key || v.owner || "";
    const data =
      typeof v.data === "string" ? v.data : typeof v.info === "string" ? v.info : "";
    if (data) {
      if (key === "TIT2" || key === "TITLE") return data.trim() || null;
      if (key.startsWith("T") && looksTitle(data)) return data.trim();
    }
  }
  if (typeof cue?.text === "string" && looksTitle(cue.text)) return cue.text.trim();
  return null;
}

// Wires hls.js (or Safari-native HLS) to a <video> via the local proxy, reports
// live stats to the store, and recovers from errors — falling back to the next
// stream of the channel, then signalling onUnavailable for channel auto-advance.
export function useHlsPlayer(
  videoRef: RefObject<HTMLVideoElement>,
  proxyBase: string | null,
  onUnavailable: () => void
): { status: PlayerStatus; detail: string | null } {
  const current = usePlayer((s) => s.current);
  const streamIndex = usePlayer((s) => s.streamIndex);
  const setStreamIndex = usePlayer((s) => s.setStreamIndex);
  const setStats = usePlayer((s) => s.setStats);
  const resetStats = usePlayer((s) => s.resetStats);
  const subtitlesEnabled = usePlayer((s) => s.subtitlesEnabled);
  const setSubtitleTracks = usePlayer((s) => s.setSubtitleTracks);
  const setSelectSubtitle = usePlayer((s) => s.setSelectSubtitle);
  const preferredAudioLang = usePlayer((s) => s.preferredAudioLang);
  const setAudioTracks = usePlayer((s) => s.setAudioTracks);
  const setSelectAudio = usePlayer((s) => s.setSelectAudio);
  const setProgramTitle = usePlayer((s) => s.setProgramTitle);
  // Read via a ref so toggling play/pause never re-runs the (heavy) load effect.
  // Gates the auto-play on manifest load, so a restored channel stays paused
  // until the user presses play (Player's play/pause effect then drives it).
  const playing = usePlayer((s) => s.playing);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const subsEnabledRef = useRef(subtitlesEnabled);
  subsEnabledRef.current = subtitlesEnabled;
  const prefAudioRef = useRef(preferredAudioLang);
  prefAudioRef.current = preferredAudioLang;
  const hlsRef = useRef<Hls | null>(null);

  const stream = current?.streams[streamIndex] ?? null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current || !stream || !proxyBase) {
      setStatus("idle");
      return;
    }

    let hls: Hls | null = null;
    let networkRetried = false;
    let cancelled = false;
    resetStats();
    setStatus("loading");
    setDetail(null);
    setProgramTitle(null);

    // Watch a metadata (ID3) text track for a "now playing" title.
    const watchMetaTrack = (track: TextTrack) => {
      track.mode = "hidden";
      track.addEventListener("cuechange", () => {
        const cues = track.activeCues;
        if (!cues) return;
        for (let i = 0; i < cues.length; i++) {
          const title = cueTitle(cues[i]);
          if (title) {
            setProgramTitle(title);
            break;
          }
        }
      });
    };
    const onAddMeta = (e: TrackEvent) => {
      const track = e.track as TextTrack | null;
      if (track && track.kind === "metadata") watchMetaTrack(track);
    };
    video.textTracks.addEventListener("addtrack", onAddMeta);
    Array.from(video.textTracks).forEach((t) => {
      if (t.kind === "metadata") watchMetaTrack(t);
    });

    const src = proxiedUrl(proxyBase, stream.url, stream.referrer, stream.userAgent);

    const giveUp = () => {
      if (cancelled) return;
      // try the next stream of this channel before declaring it dead
      if (streamIndex < current.streams.length - 1) {
        setStreamIndex(streamIndex + 1);
      } else {
        setStatus("error");
        onUnavailableRef.current();
      }
    };

    const canNative = video.canPlayType("application/vnd.apple.mpegurl");

    if (canNative && !Hls.isSupported()) {
      video.src = src;
      if (playingRef.current) video.play().catch(() => {});
      const onErr = () => {
        setDetail(video.error ? `media error ${video.error.code}` : "playback error");
        giveUp();
      };
      video.addEventListener("error", onErr);
      const onPlaying = () => setStatus("playing");
      video.addEventListener("playing", onPlaying);

      // --- subtitles (native text tracks) ---
      const subTracks = () =>
        Array.from(video.textTracks).filter(
          (t) => t.kind === "subtitles" || t.kind === "captions"
        );
      const publishNative = () => {
        const tt = subTracks();
        setSubtitleTracks(
          tt.map((t, i) => ({ id: i, label: t.label || t.language || `Track ${i + 1}` })),
          tt.findIndex((t) => t.mode === "showing")
        );
      };
      const onAddTrack = () => {
        publishNative();
        if (subsEnabledRef.current) {
          const tt = subTracks();
          if (tt.length && !tt.some((t) => t.mode === "showing")) {
            tt[0].mode = "showing";
            publishNative();
          }
        }
      };
      video.textTracks.addEventListener("addtrack", onAddTrack);
      setSelectSubtitle((i) => {
        const tt = subTracks();
        tt.forEach((t, idx) => (t.mode = idx === i ? "showing" : "disabled"));
        publishNative();
      });

      // --- audio tracks (native AudioTrackList; not in TS lib, so cast) ---
      const aList: any = (video as any).audioTracks;
      const publishNativeAudio = () => {
        if (!aList) return;
        const list = Array.from(aList) as any[];
        setAudioTracks(
          list.map((t, i) => ({
            id: i,
            label: t.label || t.language || `Audio ${i + 1}`,
            lang: t.language || "",
          })),
          list.findIndex((t) => t.enabled)
        );
      };
      const onAddAudio = () => {
        publishNativeAudio();
        const pref = prefAudioRef.current.trim().toLowerCase();
        if (pref && aList) {
          const list = Array.from(aList) as any[];
          if (list.length > 1) {
            const idx = list.findIndex(
              (t) =>
                (t.language || "").toLowerCase().startsWith(pref) ||
                (t.label || "").toLowerCase().includes(pref)
            );
            if (idx >= 0 && !list[idx].enabled) {
              list.forEach((t, i) => (t.enabled = i === idx));
              publishNativeAudio();
            }
          }
        }
      };
      if (aList) aList.addEventListener?.("addtrack", onAddAudio);
      setSelectAudio((i) => {
        const l: any = (video as any).audioTracks;
        if (!l) return;
        (Array.from(l) as any[]).forEach((t, idx) => (t.enabled = idx === i));
        publishNativeAudio();
      });

      return () => {
        cancelled = true;
        video.removeEventListener("error", onErr);
        video.removeEventListener("playing", onPlaying);
        video.textTracks.removeEventListener("addtrack", onAddTrack);
        video.textTracks.removeEventListener("addtrack", onAddMeta);
        if (aList) aList.removeEventListener?.("addtrack", onAddAudio);
        video.removeAttribute("src");
        video.load();
        setSubtitleTracks([], -1);
        setSelectSubtitle(() => {});
        setAudioTracks([], -1);
        setSelectAudio(() => {});
      };
    }

    if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 30,
        manifestLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 2,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (playingRef.current) video.play().catch(() => {});
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => setStatus("playing"));
      // EXTINF playlist titles (common on FAST / movie channels)
      hls.on(Hls.Events.FRAG_CHANGED, (_e, data) => {
        const t = (data?.frag as { title?: string } | undefined)?.title;
        if (typeof t === "string" && looksTitle(t)) setProgramTitle(t.trim());
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        setDetail(data.details || data.type);
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (!networkRetried) {
              networkRetried = true;
              hls?.startLoad();
            } else {
              giveUp();
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls?.recoverMediaError();
            break;
          default:
            giveUp();
        }
      });

      // --- subtitles ---
      const publishTracks = () => {
        if (!hls) return;
        const tracks = hls.subtitleTracks.map((t, i) => ({
          id: i,
          label: t.name || t.lang || `Track ${i + 1}`,
        }));
        setSubtitleTracks(tracks, hls.subtitleTrack);
      };
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
        publishTracks();
        // honor the saved "subtitles on" preference for newly-loaded streams
        if (subsEnabledRef.current && hls && hls.subtitleTracks.length > 0 && hls.subtitleTrack < 0) {
          hls.subtitleDisplay = true;
          hls.subtitleTrack = 0;
          publishTracks();
        }
      });
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, publishTracks);
      setSelectSubtitle((i) => {
        const h = hlsRef.current;
        if (!h) return;
        h.subtitleDisplay = i >= 0;
        h.subtitleTrack = i;
        setSubtitleTracks(
          h.subtitleTracks.map((t, idx) => ({
            id: idx,
            label: t.name || t.lang || `Track ${idx + 1}`,
          })),
          i
        );
      });

      // --- audio tracks (multi-language) ---
      const publishAudio = () => {
        if (!hls) return;
        const tracks = hls.audioTracks.map((t, i) => ({
          id: i,
          label: t.name || t.lang || `Audio ${i + 1}`,
          lang: t.lang || "",
        }));
        setAudioTracks(tracks, hls.audioTrack);
      };
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        publishAudio();
        // auto-switch to the preferred language when the stream offers it
        const pref = prefAudioRef.current.trim().toLowerCase();
        if (pref && hls && hls.audioTracks.length > 1) {
          const idx = hls.audioTracks.findIndex(
            (t) =>
              (t.lang || "").toLowerCase().startsWith(pref) ||
              (t.name || "").toLowerCase().includes(pref)
          );
          if (idx >= 0 && idx !== hls.audioTrack) {
            hls.audioTrack = idx;
            publishAudio();
          }
        }
      });
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, publishAudio);
      setSelectAudio((i) => {
        const h = hlsRef.current;
        if (!h) return;
        h.audioTrack = i;
        publishAudio();
      });

      return () => {
        cancelled = true;
        video.textTracks.removeEventListener("addtrack", onAddMeta);
        hls?.destroy();
        hlsRef.current = null;
        setSubtitleTracks([], -1);
        setSelectSubtitle(() => {});
        setAudioTracks([], -1);
        setSelectAudio(() => {});
      };
    }

    // no HLS support at all
    setStatus("error");
    return () => {
      cancelled = true;
      video.textTracks.removeEventListener("addtrack", onAddMeta);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, streamIndex, proxyBase, stream?.url]);

  // live stats poll
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const id = window.setInterval(() => {
      const buffered =
        video.buffered.length > 0
          ? video.buffered.end(video.buffered.length - 1) - video.currentTime
          : 0;
      const hls = hlsRef.current;
      const bitrateKbps = hls ? Math.round(hls.bandwidthEstimate / 1000) : null;
      const level = hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;
      const quality = level?.height
        ? `${level.height}p`
        : video.videoHeight
          ? `${video.videoHeight}p`
          : null;
      setStats({
        bufferSec: Math.max(0, buffered),
        bitrateKbps,
        quality,
      });
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, detail };
}
