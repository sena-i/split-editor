"use client";

import { useEffect, useRef } from "react";
import { AlignedPair } from "@/lib/types";

interface Props {
  pairs: AlignedPair[];
  currentTime: number;
  boundaries: number[];
  onPairClick: (time: number) => void;
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

export default function ScriptPanel({ pairs, currentTime, boundaries, onPairClick }: Props) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentTime]);

  const activePairIdx = pairs.findIndex(
    (p, i) => currentTime >= p.start && (i === pairs.length - 1 || currentTime < pairs[i + 1].start)
  );

  return (
    <div className="h-80 overflow-y-auto space-y-1 p-3 bg-gray-900 rounded-lg">
      {pairs.map((pair, idx) => {
        const isActive = idx === activePairIdx;
        const dayIdx = getDayIndex(pair.start, boundaries);
        const colorClass = REGION_COLORS[dayIdx % REGION_COLORS.length];
        const bgClass = BG_COLORS[dayIdx % BG_COLORS.length];

        // Show day header at boundary
        const isNewDay = idx === 0 || getDayIndex(pair.start, boundaries) !== getDayIndex(pairs[idx - 1].start, boundaries);

        return (
          <div key={pair.no}>
            {isNewDay && (
              <div className="text-xs font-bold text-gray-400 mt-3 mb-1">
                --- 課題{dayIdx + 1} ---
              </div>
            )}
            <div
              ref={isActive ? activeRef : undefined}
              onClick={() => onPairClick(pair.start)}
              className={`
                border-l-4 pl-3 py-1.5 cursor-pointer rounded-r transition-all
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
          </div>
        );
      })}
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${m}:${String(s).padStart(2, "0")}.${ms}`;
}
