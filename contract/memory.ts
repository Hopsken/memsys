// Shapes shared by the worker, plugins, and client. Keep this file free of local imports.

export interface Fragment {
  ref: string;
  fragment: string;
  createdAt: string;
  updatedAt: string;
}

// Items without `via` matched the cue; `via` lists the anchors that associated the rest.
export type RecallItem = Fragment & { via?: string[] };

export interface RecallResult {
  fragments: RecallItem[];
  hasMore: boolean;
}

export interface FragmentPage {
  fragments: Fragment[];
  nextCursor: string | null;
}

// Absolute ceiling enforced by core; per-instance limits live in plugins.
export const FRAGMENT_MAX = 1000;

const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

// Length is measured in Unicode grapheme clusters everywhere.
export const fragmentLength = (value: string) =>
  [...segmenter.segment(value)].length;
