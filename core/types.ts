import type { Failure, Issue, Result } from "@lib/result";

import type { Author, Fragment, Persona, Version } from "./model";

export type NotFound = Failure<
  "not-found",
  "fragment-not-found" | "persona-not-found" | "version-not-found"
>;
export type InvalidInput = Failure<"invalid", "invalid-input"> & {
  issues: Issue[];
};

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
export type Metadata = Record<string, unknown>;

export type ListedFragment = Fragment & { versions: number };

export interface FragmentPage {
  fragments: ListedFragment[];
  nextCursor: string | null;
}

export interface History {
  versions: Version[];
}

export type ActivityEntry = Version & { previous: string | null };

export interface ActivityPage {
  entries: ActivityEntry[];
  nextCursor: string | null;
}

export type ForgottenFragment = Fragment & { forgottenAt: string };

export interface ForgottenList {
  fragments: ForgottenFragment[];
}

export type Restored = Version & { versions: number };

export type ImportFormat = "ndjson" | "text";

export interface ImportResult {
  conflicts: string[];
  imported: number;
  skipped: number;
}

export interface SearchHit {
  fragment: Fragment;
  score: number;
  matchedTerms: string[];
}

export interface Association {
  fragment: Fragment;
  via: string[];
}

export interface AnchorCount {
  anchor: string;
  fragmentCount: number;
}

export interface AuthorSummary {
  by: Author;
  lastAt: string;
}

export interface Diagnostics {
  colo: string | null;
  fragments: number;
  id: string;
  storageBytes: number;
}

export interface MemoryCore {
  remember: (
    input: { fragment: string },
    by: Author
  ) => Result<Fragment, InvalidInput | NotFound>;
  revise: (
    input: { fragment: string; ref: string },
    by: Author
  ) => Result<Fragment, InvalidInput | NotFound>;
  forget: (
    input: { ref: string },
    by: Author
  ) => Result<{ ref: string }, NotFound>;
  restore: (input: { at: number; ref: string }) => Result<Restored, NotFound>;
  purge: (input: { ref: string }) => Result<{ ref: string }, NotFound>;
  importLog: (input: {
    content: string;
    format: ImportFormat;
  }) => Result<ImportResult, InvalidInput>;
  exportLog: (input: { history: boolean }) => string;

  get: (refs: string[]) => Fragment[];
  list: (input: {
    by?: Author | undefined;
    cursor?: string | undefined;
    tag?: string[] | undefined;
  }) => FragmentPage;
  history: (input: { ref: string }) => Result<History, NotFound>;
  activity: (input: {
    by?: Author | undefined;
    cursor?: string | undefined;
  }) => ActivityPage;
  authors: () => AuthorSummary[];
  forgotten: () => ForgottenList;

  search: (terms: string[]) => SearchHit[];
  associated: (keys: string[]) => Association[];
  anchors: () => AnchorCount[];
  count: () => number;
  snapshot: () => Fragment[];

  personas: () => Persona[];
  createPersona: (input: { name: string }) => Result<Persona, InvalidInput>;
  renamePersona: (input: {
    id: string;
    name: string;
  }) => Result<Persona, InvalidInput | NotFound>;
  setPersonaArchived: (input: {
    archived: boolean;
    id: string;
  }) => Result<Persona, NotFound>;

  readMetadata: (key: string) => Metadata | null;
  patchMetadata: (key: string, patch: Metadata) => Metadata;

  diagnostics: () => Promise<Diagnostics>;
}

export type Memory = {
  [K in keyof MemoryCore]: (
    ...args: Parameters<MemoryCore[K]>
  ) => Promise<Awaited<ReturnType<MemoryCore[K]>>>;
};
