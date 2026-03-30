"use client";

import { useState, useRef, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import WaveformEditor from "@/components/WaveformEditor";
import ScriptPanel from "@/components/ScriptPanel";
import { AlignedPair, Segment } from "@/lib/types";

export default function Home() {
  const [pairs, setPairs] = useState<AlignedPair[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [exporting, setExporting] = useState(false);
  const wavesurferRef = useRef<WaveSurfer | null>(null);

  const handleAudioFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioUrl(URL.createObjectURL(file));
  };

  const handleJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data: AlignedPair[] = JSON.parse(ev.target?.result as string);
        setPairs(data);
        setSegments(detectSegments(data));
      } catch { alert("Invalid JSON"); }
    };
    reader.readAsText(file);
  };

  const handleDaysFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const segs = parseDaysFile(text, pairs, audioDuration);
      if (segs.length > 0) setSegments(segs);
    };
    reader.readAsText(file);
  };

  const handlePairClick = useCallback((time: number) => {
    if (audioDuration > 0) wavesurferRef.current?.seekTo(time / audioDuration);
  }, [audioDuration]);

  // Split: cut segment at cursor, or create new segment in gap
  const handleSplitAtTime = useCallback((time: number) => {
    setSegments((prev) => {
      // Case 1: cursor is inside an existing segment → split it
      const idx = prev.findIndex((s) => time > s.start + 0.5 && time < s.end - 0.5);
      if (idx !== -1) {
        const seg = prev[idx];
        const newSegs = [...prev];
        newSegs.splice(idx, 1, { start: seg.start, end: time }, { start: time, end: seg.end });
        return newSegs;
      }

      // Case 2: cursor is in a gap → create a new segment covering the gap
      const sorted = [...prev].sort((a, b) => a.start - b.start);
      // Find gap boundaries
      let gapStart = 0;
      let gapEnd = audioDuration;
      for (const s of sorted) {
        if (s.end <= time) {
          gapStart = s.end;
        }
        if (s.start > time) {
          gapEnd = s.start;
          break;
        }
      }
      // Don't create if gap is too small or cursor is inside a segment
      if (gapEnd - gapStart < 0.2) return prev;
      const newSeg: Segment = { start: gapStart, end: gapEnd };
      const newSegs = [...prev, newSeg].sort((a, b) => a.start - b.start);
      return newSegs;
    });
  }, [audioDuration]);

  // Cut a time range out of all segments
  const handleCutRange = useCallback((cutStart: number, cutEnd: number) => {
    setSegments((prev) => {
      const result: Segment[] = [];
      for (const seg of prev) {
        // No overlap → keep as is
        if (cutEnd <= seg.start || cutStart >= seg.end) {
          result.push(seg);
          continue;
        }
        // Left portion survives
        if (cutStart > seg.start + 0.1) {
          result.push({ start: seg.start, end: cutStart });
        }
        // Right portion survives
        if (cutEnd < seg.end - 0.1) {
          result.push({ start: cutEnd, end: seg.end });
        }
        // If cut covers entire segment, it's removed
      }
      return result;
    });
  }, []);

  // Remove segment
  const handleRemoveSegment = useCallback((idx: number) => {
    setSegments((prev) => prev.filter((_, i) => i !== idx));
    setSelectedSegment(null);
  }, []);

  const handleExport = async () => {
    if (!audioBuffer || segments.length === 0) return;
    setExporting(true);
    try {
      const { sliceAndEncode } = await import("@/lib/audio-encoder");
      for (let i = 0; i < segments.length; i++) {
        const blob = await sliceAndEncode(audioBuffer, segments[i].start, segments[i].end);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `課題${i + 1}.mp3`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      alert("Export failed: " + err);
    }
    setExporting(false);
  };

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h1 className="text-xl font-bold mb-4">Split Editor</h1>

      {/* File inputs */}
      <div className="flex flex-wrap gap-4 mb-6 bg-gray-900 p-4 rounded-lg">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-400">audio.mp3</span>
          <input type="file" accept="audio/*" onChange={handleAudioFile}
            className="text-sm file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-200 file:cursor-pointer hover:file:bg-gray-600" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-400">aligned_pairs.json</span>
          <input type="file" accept=".json" onChange={handleJsonFile}
            className="text-sm file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-200 file:cursor-pointer hover:file:bg-gray-600" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-400">days_audio_whisper.txt (optional)</span>
          <input type="file" accept=".txt" onChange={handleDaysFile}
            className="text-sm file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-200 file:cursor-pointer hover:file:bg-gray-600" />
        </label>
      </div>

      {/* Waveform */}
      {audioUrl && (
        <div className="mb-4">
          <WaveformEditor
            audioUrl={audioUrl}
            pairs={pairs}
            segments={segments}
            onSegmentsChange={setSegments}
            onSplitAtTime={handleSplitAtTime}
            onSelectSegment={setSelectedSegment}
            onCutRange={handleCutRange}
            onTimeUpdate={setCurrentTime}
            onReady={setAudioDuration}
            onAudioBuffer={setAudioBuffer}
            wavesurferRef={wavesurferRef}
          />
        </div>
      )}

      {/* Segment bar */}
      {segments.length > 0 && (
        <div className="mb-4 flex gap-1.5 items-center flex-wrap">
          {segments.map((s, idx) => (
            <button key={idx}
              onClick={() => {
                setSelectedSegment(selectedSegment === idx ? null : idx);
                if (wavesurferRef.current) wavesurferRef.current.play(s.start, s.end);
              }}
              className={`px-2 py-1 rounded text-xs transition ${
                selectedSegment === idx ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}>
              課題{idx + 1}
              <span className="ml-1 opacity-60">{(s.end - s.start).toFixed(1)}s</span>
            </button>
          ))}
          <div className="ml-auto flex gap-1.5">
            {selectedSegment !== null && (
              <button onClick={() => handleRemoveSegment(selectedSegment)}
                className="px-2 py-1 bg-gray-800 hover:bg-red-800 rounded text-xs transition">
                削除
              </button>
            )}
            <button onClick={handleExport} disabled={exporting || !audioBuffer}
              className="px-3 py-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 rounded text-xs font-medium transition">
              {exporting ? "..." : "Export MP3"}
            </button>
          </div>
        </div>
      )}

      {/* Script panel */}
      {pairs.length > 0 && (
        <ScriptPanel
          pairs={pairs}
          currentTime={currentTime}
          boundaries={segments.map((s) => s.start)}
          onPairClick={handlePairClick}
        />
      )}
    </div>
  );
}

function detectSegments(pairs: AlignedPair[]): Segment[] {
  if (pairs.length === 0) return [];
  const totalDur = pairs[pairs.length - 1].end - pairs[0].start;
  const targetDays = Math.max(1, Math.round(totalDur / 37));
  if (targetDays <= 1) return [{ start: pairs[0].start, end: pairs[pairs.length - 1].end }];

  const idealDur = totalDur / targetDays;
  const bounds = [pairs[0].start];
  let nextTarget = pairs[0].start + idealDur;
  for (let i = 1; i < pairs.length; i++) {
    if (pairs[i].start >= nextTarget - idealDur * 0.3) {
      bounds.push(pairs[i].start);
      nextTarget = pairs[i].start + idealDur;
    }
  }

  const segs: Segment[] = [];
  for (let i = 0; i < bounds.length; i++) {
    const start = bounds[i];
    const end = i < bounds.length - 1 ? bounds[i + 1] : pairs[pairs.length - 1].end;
    segs.push({ start, end });
  }
  return segs;
}

function parseDaysFile(text: string, pairs: AlignedPair[], duration: number): Segment[] {
  const regex = /(?:課題|DAY)\d+\s*(?:　| )Audio\n(\d+):(\d+)〜/gi;
  const bounds: number[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const sec = parseInt(match[1]) * 60 + parseInt(match[2]);
    let closest = 0;
    let minDist = Infinity;
    for (const p of pairs) {
      const dist = Math.abs(p.start - sec);
      if (dist < minDist) { minDist = dist; closest = p.start; }
    }
    bounds.push(closest);
  }
  if (bounds.length === 0) return [];
  const lastEnd = pairs.length > 0 ? pairs[pairs.length - 1].end : duration;
  return bounds.map((b, i) => ({
    start: b,
    end: i < bounds.length - 1 ? bounds[i + 1] : lastEnd,
  }));
}
