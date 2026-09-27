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

// A listed fragment also counts the records in its history, so a list can
// tell edited fragments apart without loading each history.
export type ListedFragment = Fragment & { versions: number };

export interface FragmentPage {
  fragments: ListedFragment[];
  nextCursor: string | null;
}

// One record of a fragment's history. A null `fragment` means it was
// forgotten at `at`.
export interface Version {
  ref: string;
  fragment: string | null;
  at: string;
}

// Every record of one fragment, newest first.
export interface History {
  versions: Version[];
}

// A forgotten fragment: its last text, written at `at`, and when it was
// forgotten. Restoring the record `(ref, at)` brings it back.
export type ForgottenFragment = Fragment & { forgottenAt: string };

// Newest forgotten first.
export interface ForgottenList {
  fragments: ForgottenFragment[];
}

// A restore appends a copy of the chosen record; this is the new record.
export type Restored = Version & { versions: number };

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
