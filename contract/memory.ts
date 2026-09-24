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
