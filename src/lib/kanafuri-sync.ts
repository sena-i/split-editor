import {
  doc, setDoc, updateDoc, getDoc, serverTimestamp,
} from "firebase/firestore";
import {
  ref, uploadBytes, getDownloadURL,
} from "firebase/storage";
import { getDb } from "./firebase";
import { getStorageInstance } from "./firebase";
import { AlignedPair, Segment } from "./types";

/** Build task map: segment index → task number (1-based), respecting groups */
function buildTaskMap(segments: Segment[]): number[] {
  const segToTask: number[] = [];
  const groupToTask = new Map<number, number>();
  let taskNum = 0;
  for (let i = 0; i < segments.length; i++) {
    const g = segments[i].group;
    if (g != null) {
      if (!groupToTask.has(g)) groupToTask.set(g, ++taskNum);
      segToTask[i] = groupToTask.get(g)!;
    } else {
      segToTask[i] = ++taskNum;
    }
  }
  return segToTask;
}

/** Get effective segment index for a pair */
function getEffectiveSegIdx(pair: AlignedPair, segments: Segment[]): number {
  if (pair.assignedSegment != null && pair.assignedSegment >= -1 && pair.assignedSegment < segments.length) {
    return pair.assignedSegment;
  }
  for (let i = 0; i < segments.length; i++) {
    if (pair.start >= segments[i].start && pair.start < segments[i].end) return i;
  }
  return -1;
}

/** Generate script text in kanafuri format (same as Export Text) */
export function generateScriptText(pairs: AlignedPair[], segments: Segment[]): string {
  const segToTask = buildTaskMap(segments);
  const lines: string[] = [];
  let currentTask = -1;

  for (const pair of pairs) {
    const segIdx = getEffectiveSegIdx(pair, segments);
    if (segIdx === -1) continue;
    const taskNum = segToTask[segIdx] ?? 0;
    if (taskNum === 0) continue;

    if (taskNum !== currentTask) {
      if (currentTask !== -1) {
        lines.push("", "", "", "", "", "", "");
      }
      currentTask = taskNum;
      const firstSegIdx = segToTask.indexOf(taskNum);
      const seg = segments[firstSegIdx];
      const startMin = Math.floor(seg.start / 60);
      const startSec = Math.floor(seg.start % 60);
      const timeStr = `${String(startMin).padStart(2, "0")}:${String(startSec).padStart(2, "0")}`;
      lines.push(`課題${taskNum} Audio`);
      lines.push(`${timeStr}〜`);
    }
    lines.push(pair.en);
  }
  return lines.join("\n");
}

/** Sync series data to kanafuri's Firestore structure */
export async function syncToKanafuri(
  seriesId: string,
  title: string,
  pairs: AlignedPair[],
  segments: Segment[],
  audioUrl: string,
): Promise<void> {
  const db = getDb();
  const storage = getStorageInstance();

  // Mark series as sent
  const seriesRef = doc(db, "series", seriesId);
  await updateDoc(seriesRef, { sentToKanafuri: true });

  const projectId = `proj_${seriesId}`;
  const sectionId = `section_${seriesId}`;

  // 1. Create/update project
  const projectRef = doc(db, "projects", projectId);
  const projectSnap = await getDoc(projectRef);
  if (!projectSnap.exists()) {
    await setDoc(projectRef, {
      name: title,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    await updateDoc(projectRef, {
      name: title,
      updatedAt: serverTimestamp(),
    });
  }

  // 2. Create/update section
  const segToTask = buildTaskMap(segments);
  const taskCount = segToTask.length > 0 ? Math.max(...segToTask) : 0;

  const sectionRef = doc(db, "projects", projectId, "sections", sectionId);
  const sectionSnap = await getDoc(sectionRef);
  if (!sectionSnap.exists()) {
    await setDoc(sectionRef, {
      sectionNumber: 1,
      sectionName: seriesId,
      status: "not_started",
      dayCount: taskCount,
      updatedAt: serverTimestamp(),
    });
  } else {
    await updateDoc(sectionRef, {
      dayCount: taskCount,
      updatedAt: serverTimestamp(),
    });
  }

  // 3. Upload script.txt to Storage
  const scriptText = generateScriptText(pairs, segments);
  const scriptPath = `projects/${projectId}/sections/${sectionId}/script.txt`;
  const scriptRef = ref(storage, scriptPath);
  const scriptBlob = new Blob([scriptText], { type: "text/plain;charset=utf-8" });
  await uploadBytes(scriptRef, scriptBlob);

  // 4. Copy audio to kanafuri's storage path (fetch from URL, re-upload)
  const audioPath = `projects/${projectId}/sections/${sectionId}/audio.mp3`;
  const audioRef = ref(storage, audioPath);
  try {
    // Check if already exists
    await getDownloadURL(audioRef);
    // Already exists, skip re-upload
  } catch {
    // Download and re-upload
    const response = await fetch(audioUrl);
    const audioBlob = await response.blob();
    await uploadBytes(audioRef, audioBlob, { contentType: "audio/mpeg" });
  }
}
