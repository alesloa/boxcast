import { useEffect, useRef, type RefObject } from "react";
import { usePlayer } from "../store/player";
import { useProxyBase } from "./useProxyBase";

// Post a command to the player iframe. Cross-origin safe (parent is
// tauri://localhost in the bundled app, the iframe is http://127.0.0.1:<port>),
// so we always target "*".
function post(iframe: HTMLIFrameElement | null, msg: unknown) {
  iframe?.contentWindow?.postMessage(msg, "*");
}

/**
 * Drives a YouTube player from the shared transport store (bottom bar), so
 * play/pause, volume, and mute control YouTube the same way they control the TV
 * and radio players. State changes from the player flow back into the store.
 *
 * The player can't run directly on this page: the macOS bundled app is served
 * from the `tauri://localhost` scheme, which the YouTube IFrame API rejects as
 * an invalid origin (error 153 — every video fails to play). So we host the
 * actual `YT.Player` inside a small page served by the in-process proxy over
 * `http://127.0.0.1:<port>` (a valid HTTP origin) and bridge to it with
 * postMessage. See `proxy.rs` `/yt-player`. Dev and prod use the exact same
 * cross-origin bridge.
 */
export function useYouTubePlayer(
  hostRef: RefObject<HTMLDivElement>,
  videoId: string | null,
  cbs?: { onEnded?: () => void; onError?: (code: number) => void; onPlaying?: () => void }
) {
  const proxyBase = useProxyBase();
  // YouTube allow-lists `http://localhost` as an embedding origin but rejects
  // `http://127.0.0.1` for most videos ("Video unavailable"). The proxy binds
  // 127.0.0.1; `localhost` resolves to it, so we address the player host page
  // via localhost to get an origin YouTube accepts.
  const ytBase = proxyBase ? proxyBase.replace("127.0.0.1", "localhost") : null;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
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

  // Keep the event handlers current without re-creating the iframe.
  useEffect(() => {
    cbsRef.current = cbs;
  });

  // Create the iframe + bind the message bridge once the host and the proxy
  // base (which carries the loopback port) are both available.
  useEffect(() => {
    if (!hostRef.current || !ytBase || iframeRef.current) return;

    const iframe = document.createElement("iframe");
    iframe.src = `${ytBase}/yt-player`;
    iframe.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    iframe.setAttribute("allowfullscreen", "true");
    iframe.style.cssText = "width:100%;height:100%;border:0;display:block";
    hostRef.current.appendChild(iframe);
    iframeRef.current = iframe;

    const onMsg = (e: MessageEvent) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const m = e.data;
      if (!m || m.__mcyt !== 1) return;

      if (m.type === "ready") {
        readyRef.current = true;
        const st = usePlayer.getState();
        post(iframeRef.current, { __mccmd: 1, cmd: "volume", value: Math.round(st.volume * 100) });
        post(iframeRef.current, { __mccmd: 1, cmd: "mute", value: st.muted });
        // Honor a selection made before the player finished initializing.
        if (desiredRef.current) {
          swappingRef.current = true;
          post(iframeRef.current, { __mccmd: 1, cmd: "load", id: desiredRef.current });
        }
      } else if (m.type === "state") {
        // 1 = playing, 2 = paused, 0 = ended
        if (m.data === 1) {
          swappingRef.current = false; // the incoming video is now playing
          setPlaying(true);
          cbsRef.current?.onPlaying?.();
        } else if (m.data === 2) {
          if (swappingRef.current) return; // outgoing video's pause during a swap
          setPlaying(false);
        } else if (m.data === 0) {
          if (swappingRef.current) return; // outgoing video's end during a swap
          setPlaying(false);
          cbsRef.current?.onEnded?.(); // autoplay-next, when enabled
        }
      } else if (m.type === "error") {
        // 2 invalid id, 5 html5, 100 removed, 101/150 embedding disabled, 153 origin
        swappingRef.current = false;
        cbsRef.current?.onError?.(m.data);
      }
    };

    window.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("message", onMsg);
    };
  }, [hostRef, ytBase, setPlaying]);

  // Swap the video (or pause) when the selection changes.
  useEffect(() => {
    desiredRef.current = videoId;
    if (!iframeRef.current || !readyRef.current) return;
    if (videoId) {
      swappingRef.current = true;
      post(iframeRef.current, { __mccmd: 1, cmd: "load", id: videoId });
    } else {
      post(iframeRef.current, { __mccmd: 1, cmd: "pause" });
    }
  }, [videoId]);

  // store -> player: play / pause
  useEffect(() => {
    if (!iframeRef.current || !readyRef.current) return;
    post(iframeRef.current, { __mccmd: 1, cmd: playing ? "play" : "pause" });
  }, [playing]);

  // store -> player: volume / mute
  useEffect(() => {
    if (!iframeRef.current || !readyRef.current) return;
    post(iframeRef.current, { __mccmd: 1, cmd: "volume", value: Math.round(volume * 100) });
    post(iframeRef.current, { __mccmd: 1, cmd: "mute", value: muted });
  }, [volume, muted]);

  // Tear the iframe down on unmount (leaving Youtube mode).
  useEffect(() => {
    return () => {
      try {
        iframeRef.current?.remove();
      } catch {
        /* ignore */
      }
      iframeRef.current = null;
      readyRef.current = false;
    };
  }, []);
}
