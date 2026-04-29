"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { getAllSeries, createSeries, updateSeries, getAllUsers } from "@/lib/firestore";
import { uploadAudio } from "@/lib/storage";
import { SeriesDoc, SeriesStatus, AppUser, AlignedPair, Segment } from "@/lib/types";

const STATUS_OPTIONS: { value: SeriesStatus; label: string; cls: string }[] = [
  { value: "pending", label: "未着手", cls: "bg-gray-600" },
  { value: "in_progress", label: "作業中", cls: "bg-yellow-600" },
  { value: "completed", label: "完了", cls: "bg-green-600" },
];

export default function Home() {
  const { user, logout } = useAuth();
  const [seriesList, setSeriesList] = useState<SeriesDoc[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterAssignee, setFilterAssignee] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const [data, userList] = await Promise.all([getAllSeries(), getAllUsers()]);
    setSeriesList(data);
    setUsers(userList);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleInlineUpdate = async (id: string, field: string, value: string) => {
    await updateSeries(id, { [field]: value } as any);
    setSeriesList((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  const filtered = seriesList.filter((s) => {
    if (s.sentToKanafuri) return false;
    if (/^Series\s/i.test(s.title)) return false;
    if (filterStatus !== "all" && s.status !== filterStatus) return false;
    if (filterAssignee !== "all" && s.assignee !== filterAssignee) return false;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">全課題一覧 <span className="text-gray-500 text-base ml-2">{filtered.length}</span></h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{user?.email}</span>
          <button onClick={logout}
            className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs transition">
            Logout
          </button>
        </div>
      </div>

      {/* Filters + Create */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-gray-800 text-sm px-2 py-1.5 rounded border border-gray-700">
          <option value="all">全ステータス</option>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}
          className="bg-gray-800 text-sm px-2 py-1.5 rounded border border-gray-700">
          <option value="all">全担当者</option>
          {users.map((u) => <option key={u.uid} value={u.displayName}>{u.displayName}</option>)}
        </select>
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition ml-auto">
          + New
        </button>
      </div>

      {showCreate && <CreateForm onCreated={() => { setShowCreate(false); load(); }} />}

      {/* Table */}
      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs">
                <th className="text-left py-2 px-2 w-12">No</th>
                <th className="text-left py-2 px-2">タイトル</th>
                <th className="text-left py-2 px-2 w-16">課題数</th>
                <th className="text-left py-2 px-2 w-24">ステータス</th>
                <th className="text-left py-2 px-2 w-32">担当者</th>
                <th className="text-left py-2 px-2 w-16">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                  <td className="py-2 px-2 text-gray-500">{s.id}</td>
                  <td className="py-2 px-2">
                    <div className="truncate max-w-xs" title={s.title}>{s.title || "Untitled"}</div>
                  </td>
                  <td className="py-2 px-2 text-gray-400">{s.segments.length}</td>
                  <td className="py-2 px-2">
                    <select
                      value={s.status}
                      onChange={(e) => handleInlineUpdate(s.id, "status", e.target.value)}
                      className="bg-gray-800 text-xs px-1.5 py-1 rounded border border-gray-700 w-full"
                    >
                      {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className="py-2 px-2">
                    <select
                      value={s.assignee}
                      onChange={(e) => handleInlineUpdate(s.id, "assignee", e.target.value)}
                      className="bg-gray-800 text-xs px-1.5 py-1 rounded border border-gray-700 w-full"
                    >
                      <option value="">—</option>
                      {users.map((u) => <option key={u.uid} value={u.displayName}>{u.displayName}</option>)}
                    </select>
                  </td>
                  <td className="py-2 px-2">
                    <Link href={`/edit/${s.id}`}
                      className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded text-xs font-medium transition inline-block">
                      作業
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

    const jsonText = await jsonFile.text();
    let pairs: AlignedPair[];
    try {
      pairs = JSON.parse(jsonText);
    } catch {
      alert("Invalid JSON file.");
      setUploading(false);
      return;
    }

    let segments = detectSegments(pairs);
    if (daysFile) {
      const daysText = await daysFile.text();
      const lastEnd = pairs.length > 0 ? pairs[pairs.length - 1].end : 0;
      const parsed = parseDaysFile(daysText, pairs, lastEnd);
      if (parsed.length > 0) segments = parsed;
    }

    const id = await createSeries({
      title,
      assignee,
      audioPath: "",
      audioUrl: "",
      pairs,
      segments,
    });

    const { path, url } = await uploadAudio(id, audioFile, setProgress);
    const { updateSeries: update } = await import("@/lib/firestore");
    await update(id, { audioPath: path, audioUrl: url });

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
      <button onClick={handleSubmit} disabled={uploading}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium transition">
        {uploading ? `Uploading... ${progress.toFixed(0)}%` : "Create"}
      </button>
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
