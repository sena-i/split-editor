"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { getAllSeries, createSeries, deleteSeries } from "@/lib/firestore";
import { uploadAudio } from "@/lib/storage";
import { SeriesDoc, AlignedPair, Segment } from "@/lib/types";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: "未着手", cls: "bg-gray-700 text-gray-300" },
  in_progress: { text: "編集中", cls: "bg-yellow-700 text-yellow-200" },
  completed: { text: "完了", cls: "bg-green-700 text-green-200" },
};

export default function Home() {
  const { user, logout } = useAuth();
  const [seriesList, setSeriesList] = useState<SeriesDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await getAllSeries();
    setSeriesList(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-4xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Split Editor</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{user?.email}</span>
          <button onClick={logout}
            className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs transition">
            Logout
          </button>
        </div>
      </div>

      {/* Create button */}
      <div className="mb-4">
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition">
          + New Series
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateForm onCreated={() => { setShowCreate(false); load(); }} />
      )}

      {/* Series list */}
      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : seriesList.length === 0 ? (
        <div className="text-gray-500 text-sm bg-gray-900 rounded-lg p-8 text-center">
          No series yet. Click &quot;+ New Series&quot; to create one.
        </div>
      ) : (
        <div className="space-y-2">
          {seriesList.map((s) => {
            const st = STATUS_LABEL[s.status] ?? STATUS_LABEL.pending;
            return (
              <Link key={s.id} href={`/edit/${s.id}`}
                className="flex items-center gap-3 bg-gray-900 hover:bg-gray-800 rounded-lg p-4 transition">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{s.title || "Untitled"}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {s.pairs.length} pairs / {s.segments.length} segments
                    {s.assignee && <span className="ml-2 text-gray-400">@{s.assignee}</span>}
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${st.cls}`}>
                  {st.text}
                </span>
                <div className="text-xs text-gray-600 w-20 text-right">
                  {s.updatedAt.toLocaleDateString("ja-JP")}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [daysFile, setDaysFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleSubmit = async () => {
    if (!title || !audioFile || !jsonFile) {
      alert("Title, audio, and JSON are required.");
      return;
    }
    setUploading(true);

    // Parse JSON
    const jsonText = await jsonFile.text();
    let pairs: AlignedPair[];
    try {
      pairs = JSON.parse(jsonText);
    } catch {
      alert("Invalid JSON file.");
      setUploading(false);
      return;
    }

    // Auto-detect segments
    let segments = detectSegments(pairs);

    // Parse days file if provided
    if (daysFile) {
      const daysText = await daysFile.text();
      const lastEnd = pairs.length > 0 ? pairs[pairs.length - 1].end : 0;
      const parsed = parseDaysFile(daysText, pairs, lastEnd);
      if (parsed.length > 0) segments = parsed;
    }

    // Create Firestore doc first to get ID
    const id = await createSeries({
      title,
      assignee,
      audioPath: "",
      audioUrl: "",
      pairs,
      segments,
    });

    // Upload audio
    const { path, url } = await uploadAudio(id, audioFile, setProgress);

    // Update with audio URL
    const { updateSeries } = await import("@/lib/firestore");
    await updateSeries(id, { audioPath: path, audioUrl: url });

    setUploading(false);
    onCreated();
  };

  return (
    <div className="bg-gray-900 rounded-lg p-4 mb-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Title *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-gray-800 text-sm px-3 py-2 rounded border border-gray-700 focus:border-blue-500 outline-none"
            placeholder="e.g. Business English 101" />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Assignee</label>
          <input value={assignee} onChange={(e) => setAssignee(e.target.value)}
            className="w-full bg-gray-800 text-sm px-3 py-2 rounded border border-gray-700 focus:border-blue-500 outline-none"
            placeholder="e.g. Sena" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-400">Audio MP3 *</span>
          <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
            className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-gray-700 file:text-gray-200 file:cursor-pointer" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-400">aligned_pairs.json *</span>
          <input type="file" accept=".json" onChange={(e) => setJsonFile(e.target.files?.[0] ?? null)}
            className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-gray-700 file:text-gray-200 file:cursor-pointer" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-400">days_audio_whisper.txt</span>
          <input type="file" accept=".txt" onChange={(e) => setDaysFile(e.target.files?.[0] ?? null)}
            className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-gray-700 file:text-gray-200 file:cursor-pointer" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleSubmit} disabled={uploading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium transition">
          {uploading ? `Uploading... ${progress.toFixed(0)}%` : "Create"}
        </button>
      </div>
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
  return bounds.map((b, i) => ({
    start: b,
    end: i < bounds.length - 1 ? bounds[i + 1] : pairs[pairs.length - 1].end,
  }));
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
