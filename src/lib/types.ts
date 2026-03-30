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
}

export interface SeriesData {
  id: string;
  pairs: AlignedPair[];
  segments: Segment[];
}
