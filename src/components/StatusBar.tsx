import clsx from "clsx";
import { usePlayer } from "../store/player";
import {
  ClockIcon,
  DownIcon,
  MusicIcon,
  ResultsIcon,
  SignalIcon,
  TvIcon,
  VolumeSmallIcon,
} from "../lib/icons";

function Stat({
  icon,
  good,
  children,
}: {
  icon: React.ReactNode;
  good?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full items-center gap-[6px] border-l border-surface2 px-[13px] first:border-l-0">
      <span className={clsx(good ? "text-green" : "text-faint")}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}

const B = ({ children }: { children: React.ReactNode }) => (
  <b className="font-semibold text-statusbar-text">{children}</b>
);

function bitrateParts(kbps: number | null): { value: string; unit: string } {
  if (kbps == null) return { value: "—", unit: "" };
  return kbps >= 1000
    ? { value: (kbps / 1000).toFixed(1), unit: "Mbps" }
    : { value: String(kbps), unit: "Kbps" };
}

export function StatusBar({
  source,
  channelCount,
}: {
  source: string;
  channelCount: number;
}) {
  const mode = usePlayer((s) => s.mode);
  const stats = usePlayer((s) => s.stats);
  const programTitle = usePlayer((s) => s.programTitle);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const stationCount = usePlayer((s) => s.radioCount);
  const resultCount = usePlayer((s) => s.youtubeCount);
  const vol = muted ? 0 : Math.round(volume * 100);

  return (
    <div className="flex h-[30px] flex-none select-none items-center border-t border-border bg-statusbar px-[14px] text-[11px] text-dim">
      <div className="flex min-w-0 items-center gap-2 text-[11.5px] font-medium text-text">
        <span className="h-[7px] w-[7px] flex-none rounded-full bg-green shadow-[0_0_7px_var(--c-green)]" />
        {source}
        {mode === "tv" && programTitle && (
          <span className="truncate text-dim">
            · <span className="text-text">{programTitle}</span>
          </span>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex h-[18px] items-center">
        {mode === "tv" && (
          <>
            <Stat icon={<TvIcon size={14} />}>
              <B>{channelCount.toLocaleString("en-US")}</B> channels
            </Stat>
            <Stat icon={<SignalIcon size={14} />} good>
              HLS · <B>{stats.quality ?? "—"}</B>
            </Stat>
            <Stat icon={<DownIcon size={14} />}>
              <B>{bitrateParts(stats.bitrateKbps).value}</B> {bitrateParts(stats.bitrateKbps).unit}
            </Stat>
            <Stat icon={<ClockIcon size={14} />}>
              buffer <B>{stats.bufferSec != null ? `${stats.bufferSec.toFixed(1)}s` : "—"}</B>
            </Stat>
            <Stat icon={<VolumeSmallIcon size={14} />}>
              <B>{vol}%</B>
            </Stat>
          </>
        )}
        {mode === "radio" && (
          <>
            <Stat icon={<MusicIcon size={14} />}>
              <B>{stationCount ?? 0}</B> stations
            </Stat>
            <Stat icon={<SignalIcon size={14} />} good>
              <B>{stats.quality ?? "—"}</B>
            </Stat>
            <Stat icon={<DownIcon size={14} />}>
              <B>{bitrateParts(stats.bitrateKbps).value}</B> {bitrateParts(stats.bitrateKbps).unit}
            </Stat>
            <Stat icon={<VolumeSmallIcon size={14} />}>
              <B>{vol}%</B>
            </Stat>
          </>
        )}
        {mode === "youtube" && (
          <>
            <Stat icon={<ResultsIcon size={14} />}>
              <B>{resultCount ?? 0}</B> results
            </Stat>
            <Stat icon={<VolumeSmallIcon size={14} />}>
              <B>{vol}%</B>
            </Stat>
          </>
        )}
      </div>
    </div>
  );
}
