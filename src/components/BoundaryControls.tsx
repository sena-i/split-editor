"use client";

import { Segment } from "@/lib/types";

interface Props {
  segments: Segment[];
  selectedSegment: number | null;
  currentTime: number;
  audioDuration: number;
  onSelectSegment: (idx: number | null) => void;
  onSetStart: (idx: number, time: number) => void;
  onSetEnd: (idx: number, time: number) => void;
  onAdjustStart: (idx: number, delta: number) => void;
  onAdjustEnd: (idx: number, delta: number) => void;
  onSplitAtTime: (time: number) => void;
  onRemoveSegment: (idx: number) => void;
  onPlaySegment: (idx: number) => void;
  onExport: () => void;
  exporting: boolean;
  hasAudioBuffer: boolean;
}

export default function BoundaryControls({
  segments, selectedSegment, currentTime, audioDuration,
  onSelectSegment, onSetStart, onSetEnd, onAdjustStart, onAdjustEnd,
  onSplitAtTime, onRemoveSegment, onPlaySegment, onExport, exporting, hasAudioBuffer,
}: Props) {
  const sel = selectedSegment !== null ? segments[selectedSegment] : null;

  return (
    <div className="space-y-3">
      {/* Main actions - always visible */}
      {sel && selectedSegment !== null ? (
        <div className="bg-gray-900 rounded-lg p-4">
          {/* Selected segment info */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-lg font-bold text-white">課題{selectedSegment + 1}</span>
            <span className="text-sm text-gray-400">
              {fmt(sel.start)} → {fmt(sel.end)}
              <span className="text-yellow-400 ml-2">{(sel.end - sel.start).toFixed(1)}s</span>
            </span>
            <button onClick={() => onPlaySegment(selectedSegment)}
              className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition ml-auto">
              ▶ 再生
            </button>
          </div>

          {/* Two main buttons */}
          <div className="flex gap-3 mb-3">
            <button
              onClick={() => onSetStart(selectedSegment, currentTime)}
              className="flex-1 py-3 bg-blue-700 hover:bg-blue-600 rounded-lg text-sm font-bold transition"
            >
              ▸ ここから開始
              <span className="block text-xs font-normal text-blue-300 mt-0.5">{fmtFull(currentTime)}</span>
            </button>
            <button
              onClick={() => onSetEnd(selectedSegment, currentTime)}
              className="flex-1 py-3 bg-orange-700 hover:bg-orange-600 rounded-lg text-sm font-bold transition"
            >
              ◂ ここで終了
              <span className="block text-xs font-normal text-orange-300 mt-0.5">{fmtFull(currentTime)}</span>
            </button>
          </div>

          {/* Fine-tune (collapsible feel - smaller) */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1">
              <span className="text-gray-500 w-8">開始</span>
              {[-1, -0.5, -0.1].map((d) => (
                <button key={d} onClick={() => onAdjustStart(selectedSegment, d)}
                  className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded transition">{d}</button>
              ))}
              <span className="font-mono text-yellow-400 mx-1">{sel.start.toFixed(2)}</span>
              {[0.1, 0.5, 1].map((d) => (
                <button key={d} onClick={() => onAdjustStart(selectedSegment, d)}
                  className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded transition">+{d}</button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-gray-500 w-8">終了</span>
              {[-1, -0.5, -0.1].map((d) => (
                <button key={d} onClick={() => onAdjustEnd(selectedSegment, d)}
                  className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded transition">{d}</button>
              ))}
              <span className="font-mono text-cyan-400 mx-1">{sel.end.toFixed(2)}</span>
              {[0.1, 0.5, 1].map((d) => (
                <button key={d} onClick={() => onAdjustEnd(selectedSegment, d)}
                  className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded transition">+{d}</button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-lg p-4 text-gray-500 text-sm text-center">
          波形の課題をクリックして選択してください
        </div>
      )}

      {/* Segment pills - bottom bar */}
      <div className="flex gap-1.5 items-center flex-wrap">
        {segments.map((s, idx) => (
          <button key={idx}
            onClick={() => onSelectSegment(selectedSegment === idx ? null : idx)}
            className={`px-2 py-1 rounded text-xs transition ${
              selectedSegment === idx ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}>
            {idx + 1}
            <span className="ml-1 opacity-60">{(s.end - s.start).toFixed(0)}s</span>
          </button>
        ))}
        <div className="ml-auto flex gap-1.5">
          <button onClick={() => onSplitAtTime(currentTime)}
            className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs transition" title="N">
            ＋分割
          </button>
          {selectedSegment !== null && (
            <button onClick={() => onRemoveSegment(selectedSegment)}
              className="px-2 py-1 bg-gray-800 hover:bg-red-800 rounded text-xs transition">
              ✕削除
            </button>
          )}
          <button onClick={onExport} disabled={exporting || !hasAudioBuffer}
            className="px-3 py-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 rounded text-xs font-medium transition">
            {exporting ? "..." : "💾 Export"}
          </button>
        </div>
      </div>
    </div>
  );
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtFull(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}
