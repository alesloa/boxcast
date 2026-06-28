import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { save, confirm } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useAudioPeaks } from "../hooks/useAudioPeaks";
import { usePlayer } from "../store/player";
import { api } from "../api/client";
import { ScissorsIcon, XIcon, PlayIcon, PauseIcon, TrashIcon, VolumeIcon } from "../lib/icons";
import type { Track } from "../api/types";

type Range = { start: number; end: number };

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

const MARKER_COLOR = "#e3b341"; // split divider (yellow), distinct from blue waveform + red selection

export function AudioEditor({ track, onClose }: { track: Track; onClose: () => void }) {
  const { peaks, duration, loading } = useAudioPeaks(track.path);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // All times below are in ORIGINAL-file seconds. The collapsed "edited" view is
  // derived from `cuts`; deletions never touch the audio until Save/Overwrite.
  const [cuts, setCuts] = useState<Range[]>([]); // removed spans (will ripple-collapse)
  const [markers, setMarkers] = useState<number[]>([]); // split dividers
  const [sel, setSel] = useState<Range | null>(null); // current selection, about to delete
  const [cur, setCur] = useState(0); // playhead
  const [playing, setPlayingLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vol, setVol] = useState(1); // preview volume
  const [drag, setDrag] = useState<DragState | null>(null);

  const qc = useQueryClient();
  const setPlaying = usePlayer((s) => s.setPlaying);

  const dur = duration || track.durationSec || 1;
  const mergedCuts = useMemo(() => mergeRanges(cuts), [cuts]);
  const editedDur = useMemo(() => Math.max(0, dur - mergedCuts.reduce((a, c) => a + (c.end - c.start), 0)), [dur, mergedCuts]);
  const eDur = editedDur > 0.001 ? editedDur : dur; // guard div-by-zero in maps/render

  // Markers that still survive (not swallowed by a cut, not at the edges), with their edited
  // position and raw `markers` index (so a handle can move the right one).
  const visMarkers = useMemo(() => {
    const out: { idx: number; edited: number }[] = [];
    markers.forEach((m, idx) => {
      if (m <= 0.01 || m >= dur - 0.01) return;
      if (mergedCuts.some((c) => m > c.start && m < c.end)) return;
      const e = origToEdited(m, mergedCuts);
      if (e > 0.005 && e < eDur - 0.005) out.push({ idx, edited: e });
    });
    out.sort((a, b) => a.edited - b.edited);
    return out.filter((o, i) => i === 0 || o.edited - out[i - 1].edited > 0.01); // drop dividers collapsed onto the same seam
  }, [markers, mergedCuts, dur, eDur]);

  // Latest values for window/keyboard handlers without re-binding listeners.
  const st = useRef({ cur, sel, mergedCuts, markers, dur, eDur, visMarkers, playing });
  st.current = { cur, sel, mergedCuts, markers, dur, eDur, visMarkers, playing };

  // ---- draw the collapsed waveform (skip cut buckets, spread the rest to fill) ----
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    if (!peaks.length) return;
    const N = peaks.length;
    const bw = Math.max(1, ((dur / N) / eDur) * w - 0.5);
    ctx.fillStyle = "#549bff";
    for (let i = 0; i < N; i++) {
      const tc = ((i + 0.5) / N) * dur;
      if (mergedCuts.some((cc) => tc >= cc.start && tc < cc.end)) continue;
      const x = (origToEdited(tc, mergedCuts) / eDur) * w;
      const barH = Math.max(1, peaks[i] * h * 0.92);
      ctx.fillRect(x - bw / 2, (h - barH) / 2, bw, barH);
    }
  }, [peaks, mergedCuts, eDur, dur]);

  // ---- pointer geometry ----
  const xToEdited = (clientX: number, rect: DOMRect): number => {
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return pct * st.current.eDur;
  };
  const seek = (orig: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = orig;
  };

  // dragRef mirrors `drag` synchronously so the window handlers read the live value
  // without nesting setState inside another updater.
  const dragRef = useRef<DragState | null>(null);
  const beginDrag = (d: DragState) => {
    dragRef.current = d;
    setDrag(d);
  };

  // Scrub bar (top strip): click/drag to move the playhead.
  const onRulerDown = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const o = editedToOrig(xToEdited(e.clientX, rect), st.current.dur, st.current.mergedCuts);
    setCur(o);
    seek(o);
    beginDrag({ mode: "scrub", rect, startX: e.clientX, a: 0, b: 0, moved: false });
  };

  // Waveform body: click (or micro-drag) = select the segment under the cursor; a wide drag = arbitrary span.
  const onWaveDown = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ed = xToEdited(e.clientX, rect);
    beginDrag({ mode: "select", rect, startX: e.clientX, a: ed, b: ed, moved: false });
  };

  // Grab a yellow divider and slide it (a = raw markers index being moved).
  const onMarkerDown = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return;
    beginDrag({ mode: "marker", rect, startX: e.clientX, a: idx, b: 0, moved: false });
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === "scrub") {
        const o = editedToOrig(xToEdited(e.clientX, d.rect), st.current.dur, st.current.mergedCuts);
        setCur(o);
        seek(o);
        return;
      }
      if (d.mode === "marker") {
        const raw = editedToOrig(xToEdited(e.clientX, d.rect), st.current.dur, st.current.mergedCuts);
        const o = Math.max(0.02, Math.min(st.current.dur - 0.02, raw));
        setMarkers((ms) => ms.map((m, i) => (i === d.a ? o : m)));
        return;
      }
      // select: track the live end for the band
      const next = { ...d, b: xToEdited(e.clientX, d.rect), moved: d.moved || Math.abs(e.clientX - d.startX) > 4 };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      const d = dragRef.current;
      if (d && d.mode === "select") {
        const a = Math.min(d.a, d.b);
        const b = Math.max(d.a, d.b);
        if (d.moved && b - a > 0.05) {
          setSel({ start: editedToOrig(a, st.current.dur, st.current.mergedCuts), end: editedToOrig(b, st.current.dur, st.current.mergedCuts) });
        } else {
          selectSegmentAt(d.a); // click or micro-drag → segment under the press point
        }
      } else if (d && d.mode === "marker") {
        setMarkers((ms) => [...ms].sort((x, y) => x - y)); // re-sort after the move settles
      }
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  const selectSegmentAt = (editedPos: number) => {
    const { visMarkers: vis, eDur: ed, dur: d, mergedCuts: mc, sel: prev } = st.current;
    if (!vis.length) {
      setSel(null); // no dividers → click clears any selection
      return;
    }
    const bnds = [0, ...vis.map((o) => o.edited), ed];
    let i = 0;
    while (i < bnds.length - 1 && !(editedPos >= bnds[i] && editedPos < bnds[i + 1])) i++;
    if (i >= bnds.length - 1) i = bnds.length - 2;
    const start = editedToOrig(bnds[i], d, mc);
    const end = editedToOrig(bnds[i + 1], d, mc);
    if (prev && Math.abs(prev.start - start) < 0.02 && Math.abs(prev.end - end) < 0.02) {
      setSel(null); // click the already-selected piece → deselect
      return;
    }
    setSel({ start, end });
  };

  // ---- actions ----
  const dropMarker = () => {
    const { cur: c, mergedCuts: mc, dur: d } = st.current;
    if (c <= 0.02 || c >= d - 0.02) return;
    if (mc.some((x) => c > x.start && c < x.end)) return;
    setMarkers((ms) => (ms.some((m) => Math.abs(m - c) < 0.02) ? ms : [...ms, c].sort((a, b) => a - b)));
  };

  const deleteSelection = () => {
    const s = st.current.sel;
    if (!s || s.end - s.start < 0.01) {
      setSel(null);
      return;
    }
    setCuts((cs) => mergeRanges([...cs, { start: s.start, end: s.end }]));
    setCur(s.start);
    seek(s.start);
    setSel(null);
  };

  const togglePreview = () => {
    const a = audioRef.current;
    if (!a) return;
    if (st.current.playing) {
      a.pause();
      setPlayingLocal(false);
    } else {
      const { cur: c, mergedCuts: mc } = st.current;
      if (mc.some((x) => c >= x.start && c < x.end)) a.currentTime = c; // timeupdate will skip
      else a.currentTime = c;
      a.play().catch(() => {});
      setPlayingLocal(true);
    }
  };

  const reset = () => {
    setCuts([]);
    setMarkers([]);
    setSel(null);
  };

  // ---- keyboard: S=cut, Delete/Backspace=delete, Space=preview, Esc=close ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      const k = e.key;
      if (k === "s" || k === "S") {
        e.preventDefault();
        e.stopPropagation();
        dropMarker();
      } else if (k === "Delete" || k === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        deleteSelection();
      } else if (k === " ") {
        e.preventDefault();
        e.stopPropagation();
        togglePreview();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // Pause the main player while the editor is open.
  useEffect(() => {
    setPlaying(false);
  }, [setPlaying]);

  // Keep the preview element's volume in sync with the slider.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = vol;
  }, [vol]);

  // Skip-playback preview: jump past cut spans, keep `cur` in original time.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      const t = a.currentTime;
      const hit = st.current.mergedCuts.find((r) => t >= r.start && t < r.end);
      if (hit) {
        if (hit.end >= st.current.dur - 0.02) {
          a.pause();
          setPlayingLocal(false);
          a.currentTime = 0;
          setCur(0);
          return;
        }
        a.currentTime = hit.end;
        setCur(hit.end);
        return;
      }
      setCur(t);
    };
    a.addEventListener("timeupdate", onTime);
    return () => a.removeEventListener("timeupdate", onTime);
  }, []);

  // ---- save ----
  const cutPairs = (): [number, number][] => mergedCuts.map((r) => [r.start, r.end]);

  const saveCopy = async () => {
    if (!mergedCuts.length) return;
    const dot = track.path.lastIndexOf(".");
    const base = dot > 0 ? track.path.slice(0, dot) : track.path;
    const out = await save({ defaultPath: `${base} (edited).mp3`, filters: [{ name: "MP3", extensions: ["mp3"] }] });
    if (!out) return;
    setBusy(true);
    try {
      await api.mp3Cut(track.path, cutPairs(), out);
      onClose();
    } catch (e) {
      await confirm(`Could not save: ${e}`, { title: "Edit failed", kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const overwrite = async () => {
    if (!mergedCuts.length) return;
    const ok = await confirm("This permanently replaces the original file. Continue?", {
      title: "Overwrite original",
      kind: "warning",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.mp3Cut(track.path, cutPairs(), track.path);
      qc.invalidateQueries({ queryKey: ["lib", "tracks"] });
      onClose();
    } catch (e) {
      await confirm(`Could not save: ${e}`, { title: "Edit failed", kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  // ---- positions for overlays (percent of edited width) ----
  const pe = (orig: number) => `${(origToEdited(orig, mergedCuts) / eDur) * 100}%`;
  const selLeft = sel ? (origToEdited(sel.start, mergedCuts) / eDur) * 100 : 0;
  const selRight = sel ? (origToEdited(sel.end, mergedCuts) / eDur) * 100 : 0;
  const liveSel = drag && drag.mode === "select" && drag.moved ? { a: Math.min(drag.a, drag.b), b: Math.max(drag.a, drag.b) } : null;
  const hasEdits = mergedCuts.length > 0;

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/55"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setSel(null);
      }}
    >
      <div
        className="w-[820px] max-w-[94vw] rounded-[14px] border border-border-strong bg-bg p-5 shadow-[0_20px_60px_rgba(0,0,0,.6)]"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setSel(null);
        }}
      >
        <audio ref={audioRef} src={convertFileSrc(track.path)} preload="auto" className="hidden" />
        <div className="mb-4 flex items-center gap-3">
          <ScissorsIcon size={18} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-[650]">{track.title}</div>
            <div className="truncate text-[12px] text-dim">{track.artist}</div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-dim hover:bg-hover hover:text-text">
            <XIcon size={16} />
          </button>
        </div>

        {/* scrub bar + waveform share one horizontal extent; playhead spans both */}
        <div className="relative w-full overflow-hidden rounded-[10px] border border-border bg-elev">
          {/* scrub ruler */}
          <div
            onMouseDown={onRulerDown}
            className="relative h-[20px] cursor-ew-resize border-b border-border bg-black/20"
            title="Drag to move the playhead"
          >
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-[10px] uppercase tracking-wider text-faint">
              scrub
            </div>
          </div>

          {/* waveform */}
          <div ref={areaRef} className="relative h-[150px]">
            {loading && <div className="absolute inset-0 grid place-items-center text-[12px] text-dim">Reading waveform…</div>}
            <canvas ref={canvasRef} width={1500} height={150} className="h-full w-full cursor-crosshair" onMouseDown={onWaveDown} />

            {/* committed selection (about to delete) */}
            {sel && (
              <div
                className="pointer-events-none absolute top-0 h-full border-x border-red"
                style={{ left: `${selLeft}%`, width: `${Math.max(0, selRight - selLeft)}%`, background: "rgba(240,99,92,0.28)" }}
              />
            )}
            {/* live drag selection */}
            {liveSel && (
              <div
                className="pointer-events-none absolute top-0 h-full"
                style={{ left: `${(liveSel.a / eDur) * 100}%`, width: `${((liveSel.b - liveSel.a) / eDur) * 100}%`, background: "rgba(240,99,92,0.20)" }}
              />
            )}
            {/* split dividers — draggable to move the cut point */}
            {visMarkers.map((o) => (
              <div
                key={o.idx}
                onMouseDown={(e) => onMarkerDown(e, o.idx)}
                className="absolute top-0 z-10 h-full w-[11px] -translate-x-1/2 cursor-ew-resize"
                style={{ left: `${(o.edited / eDur) * 100}%` }}
                title="Drag to move this cut point"
              >
                <div className="pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2" style={{ background: MARKER_COLOR }} />
                <div className="pointer-events-none absolute -top-px left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45" style={{ background: MARKER_COLOR }} />
              </div>
            ))}
          </div>

          {/* playhead spans ruler + waveform */}
          <div className="pointer-events-none absolute top-0 h-full w-px bg-text" style={{ left: pe(cur) }} />
        </div>

        <div className="mt-2 flex items-center justify-between text-[11.5px] text-faint">
          <span>
            Scrub or play to position the line → <b className="text-dim">Cut here (S)</b> drops a divider. Click a piece (or drag) to select, then{" "}
            <b className="text-dim">Delete</b> — it slides back.
          </span>
        </div>

        {/* toolbar */}
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={dropMarker}
            className="flex items-center gap-1.5 rounded-[8px] border border-border bg-elev px-3 py-2 text-[12.5px] text-dim hover:bg-hover hover:text-text"
            title="Drop a split divider at the playhead (S)"
          >
            <ScissorsIcon size={15} /> Cut here <kbd className="ml-1 rounded bg-black/30 px-1 text-[10px]">S</kbd>
          </button>
          <button
            disabled={!sel}
            onClick={deleteSelection}
            className="flex items-center gap-1.5 rounded-[8px] border border-border px-3 py-2 text-[12.5px] text-red enabled:hover:bg-hover disabled:border-transparent disabled:text-faint"
            title="Remove the selected piece and slide the rest back (Delete)"
          >
            <TrashIcon size={15} /> Delete <kbd className="ml-1 rounded bg-black/30 px-1 text-[10px]">⌫</kbd>
          </button>
          <button
            onClick={togglePreview}
            className="flex items-center gap-2 rounded-[8px] border border-border bg-elev px-3 py-2 text-[12.5px] text-dim hover:bg-hover hover:text-text"
          >
            {playing ? <PauseIcon size={15} /> : <PlayIcon size={13} />} Preview
          </button>
          {hasEdits && (
            <button onClick={reset} className="rounded-[8px] px-3 py-2 text-[12.5px] text-faint hover:bg-hover hover:text-text">
              Reset
            </button>
          )}
          <div className="ml-auto flex items-center gap-2 text-dim">
            <VolumeIcon size={16} />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={vol}
              onChange={(e) => setVol(parseFloat(e.target.value))}
              className="h-1 w-28 cursor-pointer accent-[#549bff]"
              title={`Preview volume ${Math.round(vol * 100)}%`}
            />
          </div>
        </div>

        {/* deleted-pieces summary */}
        {hasEdits && (
          <div className="mt-3 flex flex-wrap gap-2">
            {mergedCuts.map((r, i) => (
              <span key={i} className="rounded-full border border-border bg-elev px-2.5 py-1 text-[11px] text-dim">
                removed {fmt(r.start)} – {fmt(r.end)}
              </span>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
          <div className="text-[12.5px] text-dim">
            {fmt(dur)} <span className="text-faint">→</span> <span className="font-semibold text-text">{fmt(editedDur)}</span>
          </div>
          <div className="flex-1" />
          <button
            disabled={!hasEdits || busy}
            onClick={overwrite}
            className="rounded-[8px] px-3 py-2 text-[12.5px] font-medium text-red enabled:hover:bg-hover disabled:text-faint"
          >
            Overwrite
          </button>
          <button
            disabled={!hasEdits || busy}
            onClick={saveCopy}
            className="rounded-[8px] bg-green px-4 py-2 text-[12.5px] font-semibold text-[var(--c-on-accent)] enabled:hover:bg-[var(--c-green-h)] disabled:opacity-50"
          >
            Save as Copy
          </button>
        </div>
      </div>
    </div>
  );
}

type DragState = { mode: "scrub" | "select" | "marker"; rect: DOMRect; startX: number; a: number; b: number; moved: boolean };

/** Merge overlapping/touching ranges into sorted, disjoint ranges. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges
    .map((r) => ({ start: Math.min(r.start, r.end), end: Math.max(r.start, r.end) }))
    .sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Original-time point → edited-time (collapsed) position. Points inside a cut map to its seam. */
export function origToEdited(t: number, merged: Range[]): number {
  let acc = 0;
  for (const c of merged) {
    if (c.end <= t) acc += c.end - c.start; // whole cut precedes t
    else if (c.start < t) acc += t - c.start; // t lands inside this cut → clamp to seam
  }
  return t - acc;
}

/** Edited-time (collapsed) position → original-time point. */
export function editedToOrig(e: number, dur: number, merged: Range[]): number {
  let acc = 0;
  let p = 0;
  for (const c of merged) {
    if (c.start > p) {
      const len = c.start - p;
      if (acc + len >= e) return p + (e - acc);
      acc += len;
    }
    p = Math.max(p, c.end);
  }
  if (p < dur) {
    const len = dur - p;
    if (acc + len >= e) return p + (e - acc);
  }
  return dur;
}
