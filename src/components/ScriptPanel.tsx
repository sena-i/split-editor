"use client";

import { useEffect, useRef, useState } from "react";
import { AlignedPair } from "@/lib/types";

interface Props {
  pairs: AlignedPair[];
  currentTime: number;
  boundaries: number[];
  onPairClick: (time: number) => void;
  onPairUpdate?: (index: number, updated: AlignedPair) => void;
  onPairAdd?: (afterIndex: number) => void;
  onPairDelete?: (index: number) => void;
}

const REGION_COLORS = [
  "border-l-blue-500",
  "border-l-emerald-500",
  "border-l-amber-500",
  "border-l-rose-500",
  "border-l-purple-500",
  "border-l-cyan-500",
  "border-l-orange-500",
  "border-l-teal-500",
  "border-l-pink-500",
  "border-l-indigo-500",
];

const BG_COLORS = [
  "bg-blue-500/10",
  "bg-emerald-500/10",
  "bg-amber-500/10",
  "bg-rose-500/10",
  "bg-purple-500/10",
  "bg-cyan-500/10",
  "bg-orange-500/10",
  "bg-teal-500/10",
  "bg-pink-500/10",
  "bg-indigo-500/10",
];

function getDayIndex(time: number, boundaries: number[]): number {
  for (let i = boundaries.length - 1; i >= 0; i--) {
    if (time >= boundaries[i]) return i;
  }
  return 0;
}

export default function ScriptPanel({ pairs, currentTime, boundaries, onPairClick, onPairUpdate, onPairAdd, onPairDelete }: Props) {
  const activeRef = useRef<HTMLDivElement>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editEn, setEditEn] = useState("");
  const [editJa, setEditJa] = useState("");

  useEffect(() => {
    if (activeRef.current && editingIdx === null) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentTime, editingIdx]);

  const activePairIdx = pairs.findIndex(
    (p, i) => currentTime >= p.start && (i === pairs.length - 1 || currentTime < pairs[i + 1].start)
  );

  const handleDoubleClick = (idx: number) => {
    if (!editMode) return;
    setEditingIdx(idx);
    setEditEn(pairs[idx].en);
    setEditJa(pairs[idx].ja || "");
  };

  const handleSave = () => {
    if (editingIdx === null) return;
    onPairUpdate?.(editingIdx, { ...pairs[editingIdx], en: editEn, ja: editJa });
    setEditingIdx(null);
  };

  const handleCancel = () => {
    setEditingIdx(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      handleCancel();
    }
    // Stop propagation so waveform shortcuts don't fire
    e.stopPropagation();
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => { setEditMode(!editMode); setEditingIdx(null); }}
          className={`px-3 py-1 rounded text-xs font-medium transition ${
            editMode ? "bg-yellow-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
          }`}
        >
          {editMode ? "Edit ON" : "Script Edit"}
        </button>
        {editMode && (
          <span className="text-[10px] text-gray-500">Double-click to edit</span>
        )}
        <button
          onClick={() => exportText(pairs, boundaries)}
          className="px-3 py-1 rounded text-xs font-medium transition bg-gray-800 text-gray-400 hover:bg-gray-700 ml-auto"
        >
          Export Text
        </button>
      </div>
      <div className="h-80 overflow-y-auto space-y-1 p-3 bg-gray-900 rounded-lg">
        {pairs.map((pair, idx) => {
          const isActive = idx === activePairIdx;
          const dayIdx = getDayIndex(pair.start, boundaries);
          const colorClass = REGION_COLORS[dayIdx % REGION_COLORS.length];
          const bgClass = BG_COLORS[dayIdx % BG_COLORS.length];
          const isEditing = editingIdx === idx;

          const isNewDay = idx === 0 || getDayIndex(pair.start, boundaries) !== getDayIndex(pairs[idx - 1].start, boundaries);

          return (
            <div key={pair.no}>
              {isNewDay && (
                <div className="text-xs font-bold text-gray-400 mt-3 mb-1">
                  --- 課題{dayIdx + 1} ---
                </div>
              )}
              {isEditing ? (
                <div
                  className={`border-l-4 pl-3 py-1.5 rounded-r ${colorClass} bg-white/10`}
                  onKeyDown={handleKeyDown}
                >
                  <div className="text-xs text-gray-500 mb-1">
                    {formatTime(pair.start)} - {formatTime(pair.end)}
                  </div>
                  <input
                    autoFocus
                    value={editEn}
                    onChange={(e) => setEditEn(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-gray-800 text-sm text-white px-2 py-1 rounded border border-gray-600 focus:border-yellow-500 outline-none mb-1"
                  />
                  <input
                    value={editJa}
                    onChange={(e) => setEditJa(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-gray-800 text-xs text-gray-300 px-2 py-1 rounded border border-gray-600 focus:border-yellow-500 outline-none mb-1"
                    placeholder="Japanese translation"
                  />
                  <div className="flex gap-1">
                    <button onClick={handleSave}
                      className="px-2 py-0.5 bg-yellow-600 hover:bg-yellow-500 rounded text-xs transition">
                      Save
                    </button>
                    <button onClick={handleCancel}
                      className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs transition">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="group relative">
                  <div
                    ref={isActive ? activeRef : undefined}
                    onClick={() => onPairClick(pair.start)}
                    onDoubleClick={() => handleDoubleClick(idx)}
                    className={`
                      border-l-4 pl-3 py-1.5 rounded-r transition-all
                      ${editMode ? "cursor-text pr-16" : "cursor-pointer"}
                      ${colorClass} ${bgClass}
                      ${isActive ? "ring-1 ring-white/30 !bg-white/15" : "hover:bg-white/5"}
                    `}
                  >
                    <div className="text-xs text-gray-500 mb-0.5">
                      {formatTime(pair.start)} - {formatTime(pair.end)}
                    </div>
                    <div className={`text-sm ${isActive ? "text-white font-medium" : "text-gray-300"}`}>
                      {pair.en}
                    </div>
                    {pair.ja && (
                      <div className="text-xs text-gray-500 mt-0.5">{pair.ja}</div>
                    )}
                  </div>
                  {editMode && (
                    <div className="absolute right-1 top-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); onPairAdd?.(idx); }}
                        className="px-1.5 py-0.5 bg-gray-700 hover:bg-green-700 rounded text-[10px] text-gray-300 transition"
                        title="この行の下に追加"
                      >＋</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onPairDelete?.(idx); }}
                        className="px-1.5 py-0.5 bg-gray-700 hover:bg-red-700 rounded text-[10px] text-gray-300 transition"
                        title="この行を削除"
                      >✕</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function exportText(pairs: AlignedPair[], boundaries: number[]) {
  const lines: string[] = [];
  let currentDay = -1;
  for (const pair of pairs) {
    const dayIdx = getDayIndex(pair.start, boundaries);
    if (dayIdx !== currentDay) {
      if (currentDay !== -1) {
        // Add blank lines between sections (matching reference format)
        lines.push("", "", "", "", "", "", "");
      }
      currentDay = dayIdx;
      const startMin = Math.floor(boundaries[dayIdx] / 60);
      const startSec = Math.floor(boundaries[dayIdx] % 60);
      const timeStr = `${String(startMin).padStart(2, "0")}:${String(startSec).padStart(2, "0")}`;
      lines.push(`課題${dayIdx + 1} Audio`);
      lines.push(`${timeStr}〜`);
    }
    lines.push(pair.en);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "days_audio_whisper.txt";
  a.click();
  URL.revokeObjectURL(url);
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${m}:${String(s).padStart(2, "0")}.${ms}`;
}
