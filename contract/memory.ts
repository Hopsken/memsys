// Shapes shared by the worker, plugins, and client. Types only; no local imports.

// A fragment is its latest record; `at` is when its current text was written.
export interface Fragment {
  ref: string;
  fragment: string;
  at: string;
}

// Items without `via` matched the cue; `via` lists the anchors that associated the rest.
export type RecallItem = Fragment & { via?: string[] };

// Recall input with defaults applied; what afterRecall hooks receive.
export interface RecallInput {
  associate: boolean;
  context: string | null;
  cue: string;
  limit: number;
}

export interface RecallResult {
  fragments: RecallItem[];
  hasMore: boolean;
}

export interface FragmentPage {
  fragments: Fragment[];
  nextCursor: string | null;
}

// One line of the fragment log, its export, and its import. A null
// `fragment` means the fragment was forgotten.
export interface LogRecord {
  v: 1;
  ref: string;
  fragment: string | null;
  at: string;
}

// Import takes a log (NDJSON) or plain text with one fragment per line.
export type ImportFormat = "ndjson" | "text";

// `conflicts` lists refs that already hold different text; they were not changed.
export interface ImportResult {
  conflicts: string[];
  imported: number;
  skipped: number;
}
