import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc,
  Timestamp, orderBy, query,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { SeriesDoc, AlignedPair, Segment } from "./types";

const COL = "series";

function toDate(ts: any): Date {
  if (ts instanceof Timestamp) return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date();
}

function docToSeries(id: string, data: any): SeriesDoc {
  return {
    id,
    title: data.title ?? "",
    status: data.status ?? "pending",
    assignee: data.assignee ?? "",
    assigneeDeadline: data.assigneeDeadline ?? "",
    reviewer: data.reviewer ?? "",
    reviewerDeadline: data.reviewerDeadline ?? "",
    audioPath: data.audioPath ?? "",
    audioUrl: data.audioUrl ?? "",
    pairs: data.pairs ?? [],
    segments: data.segments ?? [],
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export async function getAllSeries(): Promise<SeriesDoc[]> {
  const q = query(collection(getDb(), COL), orderBy("updatedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToSeries(d.id, d.data()));
}

export async function getSeries(id: string): Promise<SeriesDoc | null> {
  const snap = await getDoc(doc(getDb(), COL, id));
  if (!snap.exists()) return null;
  return docToSeries(snap.id, snap.data());
}

export async function createSeries(data: {
  title: string;
  assignee: string;
  audioPath: string;
  audioUrl: string;
  pairs: AlignedPair[];
  segments: Segment[];
}): Promise<string> {
  const ref = doc(collection(getDb(), COL));
  await setDoc(ref, {
    ...data,
    status: "pending",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return ref.id;
}

export async function updateSeries(
  id: string,
  data: Partial<Pick<SeriesDoc, "title" | "status" | "assignee" | "assigneeDeadline" | "reviewer" | "reviewerDeadline" | "pairs" | "segments" | "audioPath" | "audioUrl">>
): Promise<void> {
  await updateDoc(doc(getDb(), COL, id), {
    ...data,
    updatedAt: Timestamp.now(),
  });
}

export async function deleteSeries(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), COL, id));
}
