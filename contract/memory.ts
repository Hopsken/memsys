// Shapes shared by the worker, plugins, and client. Types only; no local imports.

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
