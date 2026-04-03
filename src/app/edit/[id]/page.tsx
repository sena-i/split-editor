"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import WaveSurfer from "wavesurfer.js";
import WaveformEditor from "@/components/WaveformEditor";
import ScriptPanel from "@/components/ScriptPanel";
import { getSeries, updateSeries } from "@/lib/firestore";
import { AlignedPair, Segment, SeriesDoc, SeriesStatus } from "@/lib/types";

const STATUS_OPTIONS: { value: SeriesStatus; label: string; cls: string }[] = [
  { value: "pending", label: "未着手", cls: "bg-gray-700" },
  { value: "in_progress", label: "編集中", cls: "bg-yellow-700" },
  { value: "completed", label: "完了", cls: "bg-green-700" },
];

export default function EditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [series, setSeries] = useState<SeriesDoc | null>(null);
  const [pairs, setPairs] = useState<AlignedPair[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [audioUrl, setAudioUrl] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<SeriesStatus>("pending");
  const [assignee, setAssignee] = useState("");
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load series from Firestore
  useEffect(() => {
    if (!id) return;
    getSeries(id).then((doc) => {
      if (!doc) { alert("Series not found"); router.push("/"); return; }
      setSeries(doc);
      setPairs(doc.pairs);
      setSegments(doc.segments);
      setAudioUrl(doc.audioUrl);
      setStatus(doc.status);
      setAssignee(doc.assignee);
    });
  }, [id, router]);

  // Auto-save segments & pairs (debounced 2s)
  const scheduleAutoSave = useCallback((newPairs: AlignedPair[], newSegments: Segment[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!id) return;
      setSaving(true);
      await updateSeries(id, { pairs: newPairs, segments: newSegments });
      setSaving(false);
    }, 2000);
  }, [id]);

  // Track changes for auto-save
  const pairsRef = useRef(pairs);
  pairsRef.current = pairs;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  useEffect(() => {
    if (series) scheduleAutoSave(pairsRef.current, segmentsRef.current);
  }, [pairs, segments, series, scheduleAutoSave]);

  const handlePairClick = useCallback((time: number) => {
    if (audioDuration > 0) wavesurferRef.current?.seekTo(time / audioDuration);
  }, [audioDuration]);

  const handlePairUpdate = useCallback((index: number, updated: AlignedPair) => {
    setPairs((prev) => {
      const next = [...prev];
      next[index] = updated;
      return next;
    });
  }, []);

  const handleSplitAtTime = useCallback((time: number) => {
    setSegments((prev) => {
      const idx = prev.findIndex((s) => time > s.start + 0.5 && time < s.end - 0.5);
      if (idx !== -1) {
        const seg = prev[idx];
        const newSegs = [...prev];
        newSegs.splice(idx, 1, { start: seg.start, end: time }, { start: time, end: seg.end });
        return newSegs;
      }
      const sorted = [...prev].sort((a, b) => a.start - b.start);
      let gapStart = 0;
      let gapEnd = audioDuration;
      for (const s of sorted) {
        if (s.end <= time) gapStart = s.end;
        if (s.start > time) { gapEnd = s.start; break; }
      }
      if (gapEnd - gapStart < 0.2) return prev;
      return [...prev, { start: gapStart, end: gapEnd }].sort((a, b) => a.start - b.start);
    });
  }, [audioDuration]);

  const handleCutRange = useCallback((cutStart: number, cutEnd: number) => {
    setSegments((prev) => {
      const maxGroup = prev.reduce((m, s) => Math.max(m, s.group ?? 0), 0);
      let nextGroup = maxGroup + 1;
      const result: Segment[] = [];
      for (const seg of prev) {
        if (cutEnd <= seg.start || cutStart >= seg.end) { result.push(seg); continue; }
        const g = seg.group ?? nextGroup++;
        if (cutStart > seg.start + 0.1) result.push({ start: seg.start, end: cutStart, group: g });
        if (cutEnd < seg.end - 0.1) result.push({ start: cutEnd, end: seg.end, group: g });
      }
      return result;
    });
  }, []);

  const handleRemoveSegment = useCallback((idx: number) => {
    setSegments((prev) => prev.filter((_, i) => i !== idx));
    setSelectedSegment(null);
  }, []);

  const handleMergeSegment = useCallback((idx: number) => {
    setSegments((prev) => {
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const a = prev[idx];
      const b = prev[idx + 1];
      const merged: Segment = { start: a.start, end: b.end };
      const newSegs = [...prev];
      newSegs.splice(idx, 2, merged);
      return newSegs;
    });
  }, []);

  const handleStatusChange = async (newStatus: SeriesStatus) => {
    setStatus(newStatus);
    if (id) await updateSeries(id, { status: newStatus });
  };

  const handleAssigneeChange = async (val: string) => {
    setAssignee(val);
    if (id) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        await updateSeries(id, { assignee: val });
      }, 1000);
    }
  };

  const handleExport = async () => {
    if (!audioBuffer || segments.length === 0) return;
    setExporting(true);
    try {
      const { sliceAndEncode, sliceAndEncodeMulti } = await import("@/lib/audio-encoder");
      const grouped = getGroupedSegments(segments);
      for (let i = 0; i < grouped.length; i++) {
        const ranges = grouped[i];
        const blob = ranges.length === 1
          ? await sliceAndEncode(audioBuffer, ranges[0].start, ranges[0].end)
          : await sliceAndEncodeMulti(audioBuffer, ranges.map(r => ({ start: r.start, end: r.end })));
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

  if (!series) {
    return <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>;
  }

  return (
    <div className="max-w-6xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.push("/")}
          className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs transition">
          &larr; Back
        </button>
        <h1 className="text-xl font-bold flex-1 truncate">{series.title}</h1>
        {saving && <span className="text-xs text-yellow-400">Saving...</span>}
        <div className="flex items-center gap-2">
          <input
            value={assignee}
            onChange={(e) => handleAssigneeChange(e.target.value)}
            className="bg-gray-800 text-xs px-2 py-1 rounded border border-gray-700 focus:border-blue-500 outline-none w-24"
            placeholder="Assignee"
          />
          <div className="flex gap-1">
            {STATUS_OPTIONS.map((opt) => (
              <button key={opt.value}
                onClick={() => handleStatusChange(opt.value)}
                className={`px-2 py-1 rounded text-xs transition ${
                  status === opt.value ? `${opt.cls} text-white` : "bg-gray-800 text-gray-500 hover:bg-gray-700"
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Local audio override */}
      <div className="mb-2">
        <label className="text-xs text-gray-500">
          音声を差し替え:
          <input type="file" accept="audio/*" className="ml-2 text-xs"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setAudioUrl(URL.createObjectURL(f));
            }} />
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
      {segments.length > 0 && (() => {
        const grouped = getGroupedSegments(segments);
        return (
          <div className="mb-4 space-y-2">
            <div className="flex gap-1.5 items-center flex-wrap">
              {grouped.map((ranges, gi) => {
                const totalDur = ranges.reduce((s, r) => s + (r.end - r.start), 0);
                const hasCut = ranges.length > 1;
                const isSelected = selectedSegment !== null &&
                  ranges.some((_, ri) => {
                    // Find the flat segment index for this group's ranges
                    let flatIdx = 0;
                    for (let g = 0; g < gi; g++) flatIdx += grouped[g].length;
                    return selectedSegment >= flatIdx && selectedSegment < flatIdx + ranges.length;
                  });
                return (
                  <button key={gi}
                    onClick={() => {
                      // Find first flat segment index of this group
                      let flatIdx = 0;
                      for (let g = 0; g < gi; g++) flatIdx += grouped[g].length;
                      setSelectedSegment(isSelected ? null : flatIdx);
                    }}
                    className={`px-2 py-1 rounded text-xs transition ${
                      isSelected ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    }`}>
                    課題{gi + 1}
                    <span className="ml-1 opacity-60">{totalDur.toFixed(1)}s</span>
                    {hasCut && <span className="ml-1 text-red-400" title="カット済み">*</span>}
                  </button>
                );
              })}
              <div className="ml-auto flex gap-1.5">
                <button onClick={() => handleSplitAtTime(currentTime)}
                  className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs transition" title="現在位置で分割 (N)">
                  ＋分割
                </button>
                {selectedSegment !== null && selectedSegment < segments.length - 1 && (
                  <button onClick={() => handleMergeSegment(selectedSegment)}
                    className="px-2 py-1 bg-gray-800 hover:bg-yellow-800 rounded text-xs transition" title="次の課題と結合">
                    結合→
                  </button>
                )}
                {selectedSegment !== null && (
                  <button onClick={() => handleRemoveSegment(selectedSegment)}
                    className="px-2 py-1 bg-gray-800 hover:bg-red-800 rounded text-xs transition">
                    ✕削除
                  </button>
                )}
                <button onClick={handleExport} disabled={exporting || !audioBuffer}
                  className="px-3 py-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 rounded text-xs font-medium transition">
                  {exporting ? "..." : "Export MP3"}
                </button>
              </div>
            </div>
            {selectedSegment !== null && segments[selectedSegment] && (
              <div className="flex items-center gap-3 bg-gray-900 rounded px-3 py-2 text-xs">
                <span className="text-gray-400">選択中: 課題{(() => {
                  const grouped2 = getGroupedSegments(segments);
                  let flatIdx = 0;
                  for (let g = 0; g < grouped2.length; g++) {
                    if (selectedSegment >= flatIdx && selectedSegment < flatIdx + grouped2[g].length) return g + 1;
                    flatIdx += grouped2[g].length;
                  }
                  return "?";
                })()}</span>
                <span className="text-gray-500">
                  {fmtTime(segments[selectedSegment].start)} → {fmtTime(segments[selectedSegment].end)}
                  <span className="text-yellow-400 ml-1">{(segments[selectedSegment].end - segments[selectedSegment].start).toFixed(1)}s</span>
                </span>
                <button onClick={() => {
                  if (wavesurferRef.current) wavesurferRef.current.play(segments[selectedSegment].start, segments[selectedSegment].end);
                }} className="px-2 py-0.5 bg-emerald-700 hover:bg-emerald-600 rounded transition">
                  ▶ 再生
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Script panel */}
      {pairs.length > 0 && (
        <ScriptPanel
          pairs={pairs}
          currentTime={currentTime}
          boundaries={segments.map((s) => s.start)}
          onPairClick={handlePairClick}
          onPairUpdate={handlePairUpdate}
        />
      )}
    </div>
  );
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getGroupedSegments(segments: Segment[]): Segment[][] {
  const groups: Segment[][] = [];
  const groupMap = new Map<number, Segment[]>();
  for (const seg of segments) {
    if (seg.group != null) {
      if (!groupMap.has(seg.group)) {
        const arr: Segment[] = [];
        groupMap.set(seg.group, arr);
        groups.push(arr);
      }
      groupMap.get(seg.group)!.push(seg);
    } else {
      groups.push([seg]);
    }
  }
  return groups;
}
