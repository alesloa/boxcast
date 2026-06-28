import type { SVGProps } from "react";

// Icons extracted verbatim from _plans/ui-mockup.html so the look is identical.
type P = SVGProps<SVGSVGElement> & { size?: number };

function S({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const TvIcon = (p: P) => (
  <S strokeWidth={1.9} {...p}>
    <rect x="2" y="6" width="20" height="13" rx="2" />
    <path d="m8 3 4 3 4-3" />
  </S>
);

export const RadioIcon = (p: P) => (
  <S strokeWidth={1.9} {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M12 3v4M12 17v4" />
  </S>
);

export const YouTubeIcon = (p: P) => (
  <S strokeWidth={1.9} {...p}>
    <rect x="2" y="5" width="20" height="14" rx="4" />
    <path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" />
  </S>
);

export const GridIcon = (p: P) => (
  <svg width={p.size ?? 13} height={p.size ?? 13} viewBox="0 0 24 24" fill="currentColor" {...p}>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
  </svg>
);

export const ListIcon = (p: P) => (
  <S strokeWidth={2.2} {...p} size={p.size ?? 13}>
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </S>
);

export const SettingsIcon = (p: P) => (
  <S strokeWidth={1.8} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </S>
);

export const SearchIcon = (p: P) => (
  <S strokeWidth={2} {...p} size={p.size ?? 15}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </S>
);

export const PlayIcon = (p: P) => (
  <svg width={p.size ?? 24} height={p.size ?? 24} viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M8 5v14l11-7z" />
  </svg>
);

export const PauseIcon = (p: P) => (
  <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
  </svg>
);

export const PrevIcon = (p: P) => (
  <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
  </svg>
);

export const NextIcon = (p: P) => (
  <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z" />
  </svg>
);

export const VolumeIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 17}>
    <path d="M11 5 6 9H2v6h4l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
  </S>
);

export const VolumeMuteIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 17}>
    <path d="M11 5 6 9H2v6h4l5 4z" />
    <path d="M22 9l-6 6M16 9l6 6" />
  </S>
);

export const LanguagesIcon = (p: P) => (
  <S strokeWidth={1.7} {...p} size={p.size ?? 18}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
  </S>
);

export const CcIcon = (p: P) => (
  <S strokeWidth={1.7} {...p} size={p.size ?? 18}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M9.5 10.2a2.2 2.2 0 1 0 0 3.6M16.5 10.2a2.2 2.2 0 1 0 0 3.6" />
  </S>
);

export const PipIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 17}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <rect x="12" y="12" width="8" height="6" rx="1" fill="currentColor" stroke="none" />
  </S>
);

export const FullscreenIcon = (p: P) => (
  <S strokeWidth={2} {...p} size={p.size ?? 16}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3" />
  </S>
);

export const StarIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <svg
    width={p.size ?? 15}
    height={p.size ?? 15}
    viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" />
  </svg>
);

export const SunIcon = (p: P) => (
  <S strokeWidth={1.9} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </S>
);

export const MoonIcon = (p: P) => (
  <S strokeWidth={1.9} {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </S>
);

export const EyeIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 16}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </S>
);

export const EyeOffIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 16}>
    <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a18 18 0 0 1-2.6 3.55M6.6 6.6A18 18 0 0 0 2 11s3.5 7 10 7a9 9 0 0 0 4.4-1.1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="m2 2 20 20" />
  </S>
);

export const XIcon = (p: P) => (
  <S strokeWidth={2} {...p} size={p.size ?? 14}>
    <path d="M6 6l12 12M18 6 6 18" />
  </S>
);

export const PlaylistIcon = (p: P) => (
  <S strokeWidth={1.9} {...p}>
    <path d="M3 6h12M3 12h12M3 18h8" />
    <path d="M16 13l5 3-5 3z" fill="currentColor" stroke="none" />
  </S>
);

export const FolderIcon = (p: P) => (
  <S strokeWidth={1.9} {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </S>
);

export const ShuffleIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 16}>
    <path d="M16 3h5v5M21 3l-7 7M4 20l7-7M16 21h5v-5M21 21 15 15M4 4l5 5" />
  </S>
);

export const RepeatIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 16}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </S>
);

export const RepeatOneIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 16}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    <path d="M11 10h1v4" />
  </S>
);

// status-bar icons
export const SignalIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 14}>
    <path d="M2 20h.01M6 20v-4M10 20v-8M14 20v-12M18 20V4" />
  </S>
);
export const DownIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 14}>
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </S>
);
export const ClockIcon = (p: P) => (
  <S strokeWidth={1.8} {...p} size={p.size ?? 14}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </S>
);
export const VolumeSmallIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 14}>
    <path d="M11 5 6 9H2v6h4l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
  </S>
);
export const MusicIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 14}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </S>
);
export const ResultsIcon = (p: P) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M8 5v14l11-7z" />
  </svg>
);

export const BanIcon = (p: P) => (
  <S strokeWidth={2} {...p}>
    <circle cx="12" cy="12" r="9" />
    <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
  </S>
);

export const RotateIcon = (p: P) => (
  <S strokeWidth={2} {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 4v4h4" />
  </S>
);

export const PencilIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 15}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </S>
);

export const ScissorsIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 16}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
  </S>
);

export const TrashIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 15}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </S>
);

export const FolderOpenIcon = (p: P) => (
  <S strokeWidth={1.9} {...p} size={p.size ?? 15}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2H7l-4 9z" />
    <path d="M3 18l3-9h17l-3 9z" />
  </S>
);

export const PlusIcon = (p: P) => (
  <S strokeWidth={2} {...p} size={p.size ?? 15}>
    <path d="M12 5v14M5 12h14" />
  </S>
);
