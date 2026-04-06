import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc,
  Timestamp, orderBy, query,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { SeriesDoc, AppUser, AlignedPair, Segment } from "./types";

const COL = "series";
const USERS_COL = "split_users";

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
    audioPath: data.audioPath ?? "",
    audioUrl: data.audioUrl ?? "",
    pairs: data.pairs ?? [],
    segments: data.segments ?? [],
    sentToKanafuri: data.sentToKanafuri ?? false,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

// --- Series ---

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
  data: Partial<Pick<SeriesDoc, "title" | "status" | "assignee" | "pairs" | "segments" | "audioPath" | "audioUrl">>
): Promise<void> {
  await updateDoc(doc(getDb(), COL, id), {
    ...data,
    updatedAt: Timestamp.now(),
  });
}

export async function deleteSeries(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), COL, id));
}

// --- Users ---

export async function registerUser(user: { uid: string; email: string | null; displayName: string | null }): Promise<void> {
  await setDoc(doc(getDb(), USERS_COL, user.uid), {
    email: user.email ?? "",
    displayName: user.displayName ?? user.email?.split("@")[0] ?? "",
    lastLogin: Timestamp.now(),
  }, { merge: true });
}

export async function getAllUsers(): Promise<AppUser[]> {
  const snap = await getDocs(collection(getDb(), USERS_COL));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      uid: d.id,
      email: data.email ?? "",
      displayName: data.displayName ?? "",
      lastLogin: toDate(data.lastLogin),
    };
  });
}
