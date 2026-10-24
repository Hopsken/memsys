export type Json = string | number | boolean | null | JsonArray | JsonObject;
export interface JsonObject {
  [key: string]: Json;
}
export type JsonArray = Json[];

export interface Fragment {
  ref: string;
  fragment: string;
  at: string;
}

export type RecallItem = Fragment & { via?: string[] };

export interface RecallInput {
  context?: string | undefined;
  cue: string;
}

export interface RecallResult {
  fragments: RecallItem[];
  truncated: boolean;
}

export interface RecallFailure {
  error: string;
  retry: boolean;
}

export type ListedFragment = Fragment & { versions: number };

export interface FragmentPage {
  fragments: ListedFragment[];
  nextCursor: string | null;
}

export type Op = "remember" | "revise" | "forget" | "restore";

export type Author = "user" | `agent:${string}`;

export interface Version {
  ref: string;
  fragment: string | null;
  at: string;
  op: Op;
  by: Author | null;
}

export interface History {
  versions: Version[];
}

export type ForgottenFragment = Fragment & { forgottenAt: string };

export type ActivityEntry = Version & { previous: string | null };

export interface ActivityPage {
  entries: ActivityEntry[];
  nextCursor: string | null;
}

export interface ForgottenList {
  fragments: ForgottenFragment[];
}

export type Restored = Version & { versions: number };

export interface LogRecord {
  v: 1;
  ref: string;
  fragment: string | null;
  at: string;
  op?: Op;
  by?: Author;
}

export type ImportFormat = "ndjson" | "text";

export interface ImportResult {
  conflicts: string[];
  imported: number;
  skipped: number;
}
