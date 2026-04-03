"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { AlignedPair, Segment } from "@/lib/types";

interface Props {
  pairs: AlignedPair[];
  currentTime: number;
  segments: Segment[];
  onPairClick: (time: number) => void;
  onPairUpdate?: (index: number, updated: AlignedPair) => void;
  onPairsReorder?: (pairs: AlignedPair[]) => void;
  onPairAdd?: (afterIndex: number) => void;
  onPairDelete?: (index: number) => void;
}

const REGION_COLORS = [
  "border-l-blue-500", "border-l-emerald-500", "border-l-amber-500",
  "border-l-rose-500", "border-l-purple-500", "border-l-cyan-500",
  "border-l-orange-500", "border-l-teal-500", "border-l-pink-500",
  "border-l-indigo-500",
];

const BG_COLORS = [
  "bg-blue-500/10", "bg-emerald-500/10", "bg-amber-500/10",
  "bg-rose-500/10", "bg-purple-500/10", "bg-cyan-500/10",
  "bg-orange-500/10", "bg-teal-500/10", "bg-pink-500/10",
  "bg-indigo-500/10",
];

/** Returns effective segment index: explicit assignment or time-based, -1 if excluded */
function getEffectiveSegIdx(pair: AlignedPair, segments: Segment[]): number {
  if (pair.assignedSegment != null && pair.assignedSegment >= -1 && pair.assignedSegment < segments.length) {
    return pair.assignedSegment;
  }
  for (let i = 0; i < segments.length; i++) {
    if (pair.start >= segments[i].start && pair.start < segments[i].end) return i;
  }
  return -1;
}

export default function ScriptPanel({ pairs, currentTime, segments, onPairClick, onPairUpdate, onPairsReorder, onPairAdd, onPairDelete }: Props) {
  const activeRef = useRef<HTMLDivElement>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editEn, setEditEn] = useState("");
  const [editJa, setEditJa] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [history, setHistory] = useState<AlignedPair[][]>([]);

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

  const handleCancel = () => setEditingIdx(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSave(); }
    if (e.key === "Escape") handleCancel();
    e.stopPropagation();
  };

  // Save snapshot for undo before any edit
  const pushHistory = useCallback(() => {
    setHistory((prev) => [...prev.slice(-19), pairs]);
  }, [pairs]);

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    onPairsReorder?.(prev);
  }, [history, onPairsReorder]);

  // Assign pair to a different segment
  const handleAssignSegment = useCallback((idx: number, newSegIdx: number) => {
    pushHistory();
    const clamped = Math.max(-1, Math.min(segments.length - 1, newSegIdx));
    onPairUpdate?.(idx, { ...pairs[idx], assignedSegment: clamped });
  }, [pairs, segments.length, onPairUpdate, pushHistory]);

  // Clear explicit assignment (revert to time-based)
  const handleClearAssignment = useCallback((idx: number) => {
    pushHistory();
    const { assignedSegment: _, ...rest } = pairs[idx];
    onPairUpdate?.(idx, rest as AlignedPair);
  }, [pairs, onPairUpdate, pushHistory]);

  // Drag and drop reorder
  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(idx);
  };
  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); setDragOverIdx(null); return; }
    pushHistory();
    const newPairs = [...pairs];
    const [moved] = newPairs.splice(dragIdx, 1);
    newPairs.splice(targetIdx, 0, moved);
    onPairsReorder?.(newPairs.map((p, i) => ({ ...p, no: i + 1 })));
    setDragIdx(null);
    setDragOverIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

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
          <>
            <button
              onClick={handleUndo}
              disabled={history.length === 0}
              className="px-2 py-1 rounded text-xs font-medium transition bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
              title="元に戻す (Undo)"
            >
              ↩ 戻る
            </button>
            <span className="text-[10px] text-gray-500">ダブルクリック: 編集 | ドラッグ: 並替 | ◀▶: 課題変更</span>
          </>
        )}
        <button
          onClick={() => exportText(pairs, segments)}
          className="px-3 py-1 rounded text-xs font-medium transition bg-gray-800 text-gray-400 hover:bg-gray-700 ml-auto"
        >
          Export Text
        </button>
      </div>
      <div className="h-80 overflow-y-auto space-y-1 p-3 bg-gray-900 rounded-lg">
        {pairs.map((pair, idx) => {
          const isActive = idx === activePairIdx;
          const segIdx = getEffectiveSegIdx(pair, segments);
          const isExcluded = segIdx === -1;
          const hasOverride = pair.assignedSegment != null;
          const colorClass = isExcluded ? "border-l-gray-700" : REGION_COLORS[segIdx % REGION_COLORS.length];
          const bgClass = isExcluded ? "bg-gray-800/30" : BG_COLORS[segIdx % BG_COLORS.length];
          const isEditing = editingIdx === idx;
          const isDragOver = dragOverIdx === idx;

          const prevSegIdx = idx > 0 ? getEffectiveSegIdx(pairs[idx - 1], segments) : -2;
          const isNewDay = !isExcluded && (idx === 0 || segIdx !== prevSegIdx);

          return (
            <div
              key={`${pair.no}-${idx}`}
              draggable={editMode && !isEditing}
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              className={isDragOver && editMode ? "border-t-2 border-yellow-400" : ""}
            >
              {isNewDay && (
                <div className="text-xs font-bold text-gray-400 mt-3 mb-1">
                  --- 課題{segIdx + 1} ---
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
                      className="px-2 py-0.5 bg-yellow-600 hover:bg-yellow-500 rounded text-xs transition">Save</button>
                    <button onClick={handleCancel}
                      className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs transition">Cancel</button>
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
                      ${editMode ? "cursor-grab pr-24" : "cursor-pointer"}
                      ${colorClass} ${bgClass}
                      ${isActive ? "ring-1 ring-white/30 !bg-white/15" : "hover:bg-white/5"}
                      ${dragIdx === idx ? "opacity-40" : ""}
                    `}
                  >
                    <div className="text-xs text-gray-500 mb-0.5">
                      {formatTime(pair.start)} - {formatTime(pair.end)}
                      {isExcluded && <span className="ml-1 text-gray-600">(除外)</span>}
                      {hasOverride && !isExcluded && <span className="ml-1 text-yellow-600">(手動)</span>}
                    </div>
                    <div className={`text-sm ${
                      isExcluded ? "text-gray-600 line-through" :
                      isActive ? "text-white font-medium" : "text-gray-300"
                    }`}>
                      {pair.en}
                    </div>
                    {pair.ja && (
                      <div className={`text-xs mt-0.5 ${isExcluded ? "text-gray-700 line-through" : "text-gray-500"}`}>{pair.ja}</div>
                    )}
                  </div>
                  {editMode && (
                    <div className="absolute right-1 top-1 flex items-center gap-0.5">
                      {/* Segment assignment — always visible */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAssignSegment(idx, segIdx - 1); }}
                        className="px-1.5 py-0.5 bg-gray-700 hover:bg-blue-700 rounded text-[10px] text-gray-300 transition"
                        title="前の課題へ"
                      >◀</button>
                      <span className="px-1 py-0.5 text-[10px] text-gray-400 min-w-[20px] text-center font-mono">
                        {isExcluded ? "−" : segIdx + 1}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAssignSegment(idx, segIdx + 1); }}
                        className="px-1.5 py-0.5 bg-gray-700 hover:bg-blue-700 rounded text-[10px] text-gray-300 transition"
                        title="次の課題へ"
                      >▶</button>
                      {hasOverride && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleClearAssignment(idx); }}
                          className="px-1 py-0.5 bg-gray-700 hover:bg-orange-700 rounded text-[10px] text-yellow-400 transition"
                          title="自動割当に戻す"
                        >↺</button>
                      )}
                      {/* Add/Delete — hover only */}
                      <div className="flex gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); pushHistory(); onPairAdd?.(idx); }}
                          className="px-1 py-0.5 bg-gray-700 hover:bg-green-700 rounded text-[10px] text-gray-300 transition"
                          title="この行の下に追加"
                        >＋</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); pushHistory(); onPairDelete?.(idx); }}
                          className="px-1 py-0.5 bg-gray-700 hover:bg-red-700 rounded text-[10px] text-gray-300 transition"
                          title="この行を削除"
                        >✕</button>
                      </div>
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

function exportText(pairs: AlignedPair[], segments: Segment[]) {
  const lines: string[] = [];
  let currentSegIdx = -1;
  let taskNum = 0;
  for (const pair of pairs) {
    const segIdx = getEffectiveSegIdx(pair, segments);
    if (segIdx === -1) continue;
    if (segIdx !== currentSegIdx) {
      if (currentSegIdx !== -1) {
        lines.push("", "", "", "", "", "", "");
      }
      currentSegIdx = segIdx;
      taskNum++;
      const seg = segments[segIdx];
      const startMin = Math.floor(seg.start / 60);
      const startSec = Math.floor(seg.start % 60);
      const timeStr = `${String(startMin).padStart(2, "0")}:${String(startSec).padStart(2, "0")}`;
      lines.push(`課題${taskNum} Audio`);
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
