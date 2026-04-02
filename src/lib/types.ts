export interface AlignedPair {
  no: number;
  en: string;
  ja: string;
  start: number;
  end: number;
  is_question?: boolean;
}

export interface Segment {
  start: number;
  end: number;
  group?: number; // segments with same group are concatenated into one MP3 on export
}

export type SeriesStatus = "pending" | "in_progress" | "completed";

export interface SeriesDoc {
  id: string;
  title: string;
  status: SeriesStatus;
  assignee: string;
  audioPath: string;
  audioUrl: string;
  pairs: AlignedPair[];
  segments: Segment[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  lastLogin: Date;
}
