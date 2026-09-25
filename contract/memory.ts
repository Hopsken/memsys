// Shapes shared by the worker, plugins, and client. Types only; no local imports.

export interface Fragment {
  ref: string;
  fragment: string;
  createdAt: string;
  updatedAt: string;
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

// A whole memory as a file, for moving it between instances.
export interface FragmentExport {
  format: "memsys.fragments";
  version: 1;
  exportedAt: string;
  fragments: Fragment[];
}

// `conflicts` lists refs that already hold different text; they were not changed.
export interface ImportResult {
  conflicts: string[];
  imported: number;
  skipped: number;
}
