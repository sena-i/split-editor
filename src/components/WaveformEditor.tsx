"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import MinimapPlugin from "wavesurfer.js/dist/plugins/minimap.esm.js";
import { AlignedPair, Segment } from "@/lib/types";

const SNAP = 0.15;
const snap = (t: number) => Math.round(t / SNAP) * SNAP;

const REGION_COLORS = [
  "rgba(59,130,246,0.18)", "rgba(16,185,129,0.18)", "rgba(245,158,11,0.18)",
  "rgba(244,63,94,0.18)", "rgba(168,85,247,0.18)", "rgba(6,182,212,0.18)",
  "rgba(249,115,22,0.18)", "rgba(20,184,166,0.18)", "rgba(236,72,153,0.18)",
  "rgba(99,102,241,0.18)",
];

interface Props {
  audioUrl: string;
  pairs: AlignedPair[];
  segments: Segment[];
  onSegmentsChange: (segs: Segment[]) => void;
  onSplitAtTime?: (time: number) => void;
  onSelectSegment?: (idx: number) => void;
  onCutRange?: (start: number, end: number) => void;
  onTimeUpdate: (time: number) => void;
  onReady: (duration: number) => void;
  onAudioBuffer: (buffer: AudioBuffer) => void;
  wavesurferRef: React.MutableRefObject<WaveSurfer | null>;
}

export default function WaveformEditor({
  audioUrl, pairs, segments, onSegmentsChange, onSplitAtTime, onSelectSegment, onCutRange, onTimeUpdate, onReady, onAudioBuffer, wavesurferRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const destroyedRef = useRef(false);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [zoom, setZoom] = useState(0);
  // Suppress region redraws while programmatically updating or while user is dragging
  const suppressUpdateRef = useRef(false);
  const draggingIdRef = useRef<string | null>(null);

  const splitRef = useRef(onSplitAtTime);
  splitRef.current = onSplitAtTime;
  const cutRangeRef = useRef(onCutRange);
  cutRangeRef.current = onCutRange;
  const selectSegRef = useRef(onSelectSegment);
  selectSegRef.current = onSelectSegment;
  const segmentsChangeRef = useRef(onSegmentsChange);
  segmentsChangeRef.current = onSegmentsChange;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;
    destroyedRef.current = false;

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const minimap = MinimapPlugin.create({
      height: 24, waveColor: "#374151", progressColor: "#60a5fa",
      overlayColor: "rgba(255,255,255,0.05)",
    });

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#4a5568", progressColor: "#63b3ed",
      cursorColor: "#f6e05e", cursorWidth: 2,
      height: 128, barWidth: 2, barGap: 1, barRadius: 2,
      minPxPerSec: 0, plugins: [regions, minimap],
    });

    wavesurferRef.current = ws;
    ws.load(audioUrl);

    // Manual drag selection — replaces enableDragSelection which miscalculates
    // positions when zoomed, causing clicks to jump to wrong locations
    let dragStartTime: number | null = null;
    let isDragging = false;
    let dragRegionId: string | null = null;

    const getTimeFromMouseEvent = (e: MouseEvent): number => {
      const wrapper = ws.getWrapper();
      const rect = wrapper.getBoundingClientRect();
      const x = e.clientX - rect.left + wrapper.scrollLeft;
      const dur = ws.getDuration();
      const totalWidth = wrapper.scrollWidth;
      return Math.max(0, Math.min(dur, (x / totalWidth) * dur));
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Ignore if clicking on a region resize handle
      const target = e.target as HTMLElement;
      if (target.closest('[data-resize]') || target.style.cursor === 'ew-resize') return;
      dragStartTime = getTimeFromMouseEvent(e);
      isDragging = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (dragStartTime === null) return;
      const t = getTimeFromMouseEvent(e);
      if (!isDragging && Math.abs(t - dragStartTime) >= 0.1) {
        isDragging = true;
        // Remove previous selection regions
        regions.getRegions().forEach((r) => { if (!r.id.startsWith("seg-")) r.remove(); });
      }
      if (isDragging) {
        const start = Math.min(dragStartTime, t);
        const end = Math.max(dragStartTime, t);
        // Update or create the drag region
        if (dragRegionId) {
          const existing = regions.getRegions().find((r) => r.id === dragRegionId);
          if (existing) existing.remove();
        }
        const region = regions.addRegion({
          start, end,
          color: "rgba(239,68,68,0.25)",
          drag: false, resize: false,
        });
        dragRegionId = region.id;
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (dragStartTime === null) return;
      if (isDragging) {
        const t = getTimeFromMouseEvent(e);
        const start = Math.min(dragStartTime, t);
        const end = Math.max(dragStartTime, t);
        if (end - start >= 0.1) {
          const sel = { start, end };
          selectionRef.current = sel;
          setSelection(sel);
        }
      }
      dragStartTime = null;
      isDragging = false;
      dragRegionId = null;
    };

    const wrapper = ws.getWrapper();
    wrapper.addEventListener("mousedown", onMouseDown);
    wrapper.addEventListener("mousemove", onMouseMove);
    wrapper.addEventListener("mouseup", onMouseUp);

    ws.on("ready", () => {
      if (destroyedRef.current) return;
      const dur = ws.getDuration();
      setDuration(dur);
      onReady(dur);
      const backend = (ws as any).getDecodedData();
      if (backend) onAudioBuffer(backend);
    });

    ws.on("audioprocess", (t: number) => {
      if (!destroyedRef.current) { setCurrentTime(t); onTimeUpdate(t); }
    });
    ws.on("seeking", (t: number) => {
      if (!destroyedRef.current) { setCurrentTime(t); onTimeUpdate(t); }
    });
    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));

    ws.on("dblclick", () => {
      if (destroyedRef.current) return;
      const cur = ws.options.minPxPerSec || 0;
      ws.zoom(cur < 10 ? 50 : cur < 100 ? 200 : 500);
      setZoom(cur < 10 ? 50 : cur < 100 ? 200 : 500);
    });

    const container = containerRef.current;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const cur = ws.options.minPxPerSec || 0;
        const next = Math.max(0, Math.min(1000, cur + (e.deltaY > 0 ? -20 : 20)));
        ws.zoom(next); setZoom(next);
      }
    };
    container?.addEventListener("wheel", handleWheel, { passive: false });

    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          if (ws.isPlaying()) {
            ws.pause();
          } else {
            ws.play(ws.getCurrentTime()); // unbounded play from current position
          }
          break;
        case "ArrowLeft": e.preventDefault(); ws.skip(e.shiftKey ? -5 : -1); break;
        case "ArrowRight": e.preventDefault(); ws.skip(e.shiftKey ? 5 : 1); break;
        case "KeyN": e.preventDefault(); splitRef.current?.(ws.getCurrentTime()); break;
        case "Delete":
        case "Backspace": {
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) break;
          const sel = selectionRef.current;
          if (sel && sel.end - sel.start > 0.05) {
            e.preventDefault();
            cutRangeRef.current?.(sel.start, sel.end);
            regions.getRegions().forEach((r) => { if (!r.id.startsWith("seg-")) r.remove(); });
            selectionRef.current = null;
            setSelection(null);
          }
          break;
        }
        case "Escape":
          e.preventDefault();
          regions.getRegions().forEach((r) => { if (!r.id.startsWith("seg-")) r.remove(); });
          selectionRef.current = null;
          setSelection(null);
          break;
        case "Home": e.preventDefault(); ws.seekTo(0); break;
        case "End": e.preventDefault(); ws.seekTo(1); break;
      }
    };
    document.addEventListener("keydown", handleKey);

    return () => {
      destroyedRef.current = true;
      container?.removeEventListener("wheel", handleWheel);
      document.removeEventListener("keydown", handleKey);
      wrapper.removeEventListener("mousedown", onMouseDown);
      wrapper.removeEventListener("mousemove", onMouseMove);
      wrapper.removeEventListener("mouseup", onMouseUp);
      ws.destroy();
      wavesurferRef.current = null;
    };
  }, [audioUrl]);

  // Draw segments as resizable regions
  useEffect(() => {
    if (!regionsRef.current || duration <= 0 || destroyedRef.current) return;
    // Don't redraw while user is dragging a handle
    if (draggingIdRef.current) return;
    const r = regionsRef.current;
    suppressUpdateRef.current = true;
    r.getRegions().forEach((reg) => { if (reg.id.startsWith("seg-")) reg.remove(); });
    // Assign logical task numbers in timeline order
    // Each ungrouped segment = new task number, each group = one task number
    const segTaskNum: number[] = [];
    const segFragLabel: string[] = [];
    let taskNum = 0;
    const groupToTask = new Map<number, number>();
    const groupFragCount = new Map<number, number>();
    for (let i = 0; i < segments.length; i++) {
      const g = segments[i].group;
      if (g != null) {
        if (!groupToTask.has(g)) {
          groupToTask.set(g, taskNum++);
          groupFragCount.set(g, 0);
        }
        const fragIdx = groupFragCount.get(g)!;
        groupFragCount.set(g, fragIdx + 1);
        segTaskNum[i] = groupToTask.get(g)!;
        segFragLabel[i] = String.fromCharCode(97 + fragIdx); // a, b, c...
      } else {
        segTaskNum[i] = taskNum++;
        segFragLabel[i] = "";
      }
    }
    // Check if groups actually have multiple fragments
    const groupMulti = new Set<number>();
    for (const [g, count] of groupFragCount) { if (count > 1) groupMulti.add(g); }

    segments.forEach((seg, i) => {
      const gi = segTaskNum[i];
      const colorIdx = gi % REGION_COLORS.length;
      const suffix = seg.group != null && groupMulti.has(seg.group) ? segFragLabel[i] : "";
      const label = `課題${gi + 1}${suffix}`;

      const region = r.addRegion({
        id: `seg-${i}`,
        start: seg.start, end: seg.end,
        color: REGION_COLORS[colorIdx],
        drag: false,
        resize: true,
        content: label,
      });
      region.on("click", () => {
        selectSegRef.current?.(i);
      });
      // Track drag start to prevent other regions from being affected
      region.on("update", () => {
        draggingIdRef.current = region.id;
      });
      // On drag end: snap and commit
      region.on("update-end", () => {
        draggingIdRef.current = null;
        const idx = parseInt(region.id.replace("seg-", ""), 10);
        const segs = [...segmentsRef.current];
        if (idx >= 0 && idx < segs.length) {
          segs[idx] = { ...segs[idx], start: snap(region.start), end: snap(region.end) };
          segmentsChangeRef.current(segs);
        }
      });
    });
    suppressUpdateRef.current = false;
  }, [segments, duration]);

  const togglePlay = () => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    console.log("[WS] togglePlay", { isPlaying: ws.isPlaying(), currentTime: ws.getCurrentTime(), duration: ws.getDuration() });
    try {
      const el = (ws as any).getMediaElement?.();
      if (el) console.log("[WS] mediaElement", { paused: el.paused, src: el.src?.slice(0,50), readyState: el.readyState, error: el.error });
    } catch {}
    if (ws.isPlaying()) {
      ws.pause();
    } else {
      ws.playPause();
    }
  };
  const handleZoom = (level: number) => { wavesurferRef.current?.zoom(level); setZoom(level); };

  return (
    <div>
      <div ref={containerRef} className="bg-gray-900 rounded-lg p-2 cursor-crosshair" />
      <div className="flex items-center gap-3 mt-2 flex-wrap">
        <button onClick={togglePlay}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition">
          {isPlaying ? "⏸ Pause" : "▶ Play"}
        </button>
        <span className="font-mono text-sm text-yellow-400 min-w-[100px]">
          {fmtFull(currentTime)} / {fmtFull(duration)}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs text-gray-500 mr-1">Zoom:</span>
          {[{l:"Fit",v:0},{l:"2x",v:50},{l:"5x",v:200},{l:"10x",v:500},{l:"20x",v:1000}].map(({l,v})=>(
            <button key={v} onClick={()=>handleZoom(v)}
              className={`px-2 py-1 rounded text-xs transition ${zoom===v?"bg-blue-600 text-white":"bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
              {l}
            </button>
          ))}
        </div>
        {selection && (
          <div className="flex items-center gap-2 bg-red-900/30 border border-red-800/50 rounded px-3 py-1">
            <span className="text-xs text-red-300">
              選択: {fmtFull(selection.start)} → {fmtFull(selection.end)}
              <span className="text-red-400 ml-1">({(selection.end - selection.start).toFixed(2)}s)</span>
            </span>
            <button
              onClick={() => {
                cutRangeRef.current?.(selection.start, selection.end);
                regionsRef.current?.getRegions().forEach((r) => { if (!r.id.startsWith("seg-")) r.remove(); });
                selectionRef.current = null;
                setSelection(null);
              }}
              className="px-2 py-0.5 bg-red-700 hover:bg-red-600 rounded text-xs font-medium transition"
            >
              カット
            </button>
            <button
              onClick={() => {
                regionsRef.current?.getRegions().forEach((r) => { if (!r.id.startsWith("seg-")) r.remove(); });
                selectionRef.current = null;
                setSelection(null);
              }}
              className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs transition"
            >
              解除
            </button>
          </div>
        )}
        <div className="text-[10px] text-gray-600 w-full mt-1">
          Space: 再生/停止 | ←→: 1s | Shift+←→: 5s | N: 分割 | ドラッグ: 範囲選択 | Delete: カット | Esc: 選択解除 | 端をドラッグ: 境界調整(0.15s単位)
        </div>
      </div>
    </div>
  );
}

function fmtFull(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}
