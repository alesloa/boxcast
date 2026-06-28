import { useEffect, useRef, type RefObject } from "react";
import { usePlayer } from "../store/player";

// Load the official YouTube IFrame Player API exactly once, shared across calls.
let apiPromise: Promise<any> | null = null;
function loadYouTubeApi(): Promise<any> {
  const w = window as any;
  if (w.YT && w.YT.Player) return Promise.resolve(w.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(w.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

/**
 * Drives an embedded YouTube player from the shared transport store, so the
 * bottom bar's play/pause, volume, and mute control YouTube the same way they
 * control the TV and radio players. State changes from the player's own
 * controls flow back into the store. Uses the official IFrame Player API.
 *
 * The player is mounted into a plain DOM child of `hostRef` (created
 * imperatively, not by React) so that YouTube replacing that node with its
 * iframe never collides with React's own DOM bookkeeping.
 */
export function useYouTubePlayer(
  hostRef: RefObject<HTMLDivElement>,
  videoId: string | null,
  cbs?: { onEnded?: () => void; onError?: (code: number) => void; onPlaying?: () => void }
) {
  const playerRef = useRef<any>(null);
  const readyRef = useRef(false);
  const desiredRef = useRef<string | null>(videoId);
  const cbsRef = useRef(cbs);
  // True from the moment we ask to load a new video until it actually starts
  // playing. YouTube emits paused/ended events for the OUTGOING video during a
  // swap; without this guard those would pause or skip the incoming one.
  const swappingRef = useRef(false);
  const setPlaying = usePlayer((s) => s.setPlaying);
  const playing = usePlayer((s) => s.playing);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);

  // Keep the event handlers current without re-creating the player.
  useEffect(() => {
    cbsRef.current = cbs;
  });

  // Create the player once the host element and the API are both available.
  useEffect(() => {
    let cancelled = false;
    if (!hostRef.current || !videoId || playerRef.current) return;
    desiredRef.current = videoId;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current || playerRef.current) return;
      const mount = document.createElement("div");
      hostRef.current.appendChild(mount);
      playerRef.current = new YT.Player(mount, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: { autoplay: 0, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: (e: any) => {
            readyRef.current = true;
            const st = usePlayer.getState();
            e.target.setVolume(Math.round(st.volume * 100));
            st.muted ? e.target.mute() : e.target.unMute();
            // Honor a selection made before the player finished initializing.
            if (desiredRef.current && desiredRef.current !== videoId) {
              swappingRef.current = true;
              e.target.loadVideoById(desiredRef.current);
            } else if (st.playing) {
              e.target.playVideo();
            }
          },
          onStateChange: (e: any) => {
            // 1 = playing, 2 = paused, 0 = ended
            if (e.data === 1) {
              swappingRef.current = false; // the incoming video is now playing
              setPlaying(true);
              cbsRef.current?.onPlaying?.();
            } else if (e.data === 2) {
              if (swappingRef.current) return; // outgoing video's pause during a swap
              setPlaying(false);
            } else if (e.data === 0) {
              if (swappingRef.current) return; // outgoing video's end during a swap
              setPlaying(false);
              cbsRef.current?.onEnded?.(); // autoplay-next, when enabled
            }
          },
          onError: (e: any) => {
            // 2 invalid id, 5 html5, 100 removed, 101/150 embedding disabled
            swappingRef.current = false;
            cbsRef.current?.onError?.(e.data);
          },
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [hostRef, videoId, setPlaying]);

  // Swap the video (or pause) when the selection changes.
  useEffect(() => {
    desiredRef.current = videoId;
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    try {
      if (videoId) {
        swappingRef.current = true;
        p.loadVideoById(videoId);
      } else {
        p.pauseVideo();
      }
    } catch {
      /* player not ready */
    }
  }, [videoId]);

  // store -> player: play / pause
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    try {
      playing ? p.playVideo() : p.pauseVideo();
    } catch {
      /* ignore */
    }
  }, [playing]);

  // store -> player: volume / mute
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    try {
      p.setVolume(Math.round(volume * 100));
      muted ? p.mute() : p.unMute();
    } catch {
      /* ignore */
    }
  }, [volume, muted]);

  // Tear the player down on unmount (leaving Youtube mode).
  useEffect(() => {
    return () => {
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      readyRef.current = false;
    };
  }, []);
}
