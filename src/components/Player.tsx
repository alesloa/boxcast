import { useEffect, type RefObject } from "react";
import clsx from "clsx";
import { usePlayer } from "../store/player";
import { useProxyBase } from "../hooks/useProxyBase";
import { useHlsPlayer } from "../hooks/useHlsPlayer";
import { PlayIcon, PauseIcon } from "../lib/icons";

export function Player({
  videoRef,
  onUnavailable,
}: {
  videoRef: RefObject<HTMLVideoElement>;
  onUnavailable: () => void;
}) {
  const current = usePlayer((s) => s.current);
  const streamIndex = usePlayer((s) => s.streamIndex);
  const playing = usePlayer((s) => s.playing);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const stats = usePlayer((s) => s.stats);
  const programTitle = usePlayer((s) => s.programTitle);

  const proxyBase = useProxyBase();
  const { status, detail } = useHlsPlayer(videoRef, proxyBase, onUnavailable);

  // sync volume / mute
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    v.volume = volume;
  }, [volume, muted, current?.id]);

  // sync play / pause
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing, current?.id, status]);

  const stream = current?.streams[streamIndex] ?? null;
  const quality = stats.quality ?? stream?.quality ?? null;

  const sub = current
    ? [
        current.categories[0],
        current.country ? `${current.country.flag} ${current.country.name}` : null,
        current.languages.slice(0, 2).join(", ") || null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className="flex flex-1 flex-col gap-3 p-4" style={{ minWidth: 0 }}>
      <div
        className="group relative flex flex-1 items-end overflow-hidden rounded-[12px] border border-border-strong"
        style={{
          background:
            "radial-gradient(120% 120% at 70% 10%, rgba(84,155,255,.18), transparent 55%), radial-gradient(120% 120% at 20% 90%, var(--c-green-bg), transparent 55%), linear-gradient(160deg,#1a2230,#15181d)",
        }}
      >
        <video
          ref={videoRef}
          playsInline
          className="absolute inset-0 h-full w-full bg-black object-contain transition-opacity duration-300"
          style={{ opacity: status === "playing" ? 1 : 0 }}
        />

        {current && status === "playing" && (
          <div className="absolute left-[14px] top-[14px] flex items-center gap-[7px] rounded-[7px] bg-black/50 px-[11px] py-[5px] text-[11px] font-bold tracking-[.5px] backdrop-blur-md">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red" />
            LIVE
          </div>
        )}

        {current && quality && (
          <div className="absolute right-[14px] top-[14px] rounded-[7px] bg-black/50 px-[10px] py-[5px] text-[11px] font-[650] text-dim backdrop-blur-md">
            {quality} · HLS
          </div>
        )}

        {/* center overlay */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {!current ? (
            <div className="text-center text-dim">
              <div className="text-[15px] font-medium text-text">Nothing playing</div>
              <div className="mt-1 text-[12.5px]">Pick a channel from the list to start watching</div>
            </div>
          ) : status === "loading" ? (
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          ) : status === "error" ? (
            <div className="text-center text-dim">
              <div className="text-[14px] font-semibold text-red">Stream unavailable</div>
              <div className="mt-1 text-[12px]">Skipping to the next channel…</div>
              {detail && <div className="mt-1 text-[11px] text-faint">{detail}</div>}
            </div>
          ) : (
            <button
              onClick={togglePlay}
              className={clsx(
                "grid h-[74px] w-[74px] place-items-center rounded-full border border-white/[.18] bg-white/10 text-white backdrop-blur-md transition-opacity duration-200 hover:bg-white/[.18]",
                // While playing, behave like media controls: reveal on hover only.
                playing
                  ? "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
                  : "pointer-events-auto opacity-100"
              )}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
            </button>
          )}
        </div>

        {/* meta */}
        {current && (
          <div
            className="relative w-full p-[18px]"
            style={{ background: "linear-gradient(180deg,transparent,rgba(0,0,0,.55))" }}
          >
            <h2 className="text-[18px] font-[650]">{current.name}</h2>
            {sub && <p className="mt-[3px] text-[12.5px] text-dim">{sub}</p>}
            {programTitle && programTitle.toLowerCase() !== current.name.toLowerCase() && (
              <p className="mt-[7px] flex items-center gap-[7px] text-[13.5px] font-medium text-green">
                <span className="h-[6px] w-[6px] flex-none rounded-full bg-green shadow-[0_0_6px_var(--c-green)]" />
                <span className="truncate">{programTitle}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
