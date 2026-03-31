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

export interface SeriesData {
  id: string;
  pairs: AlignedPair[];
  segments: Segment[];
}
