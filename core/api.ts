import type {
  ActivityPage,
  Author,
  ForgottenList,
  Fragment,
  FragmentPage,
  History,
  ImportFormat,
  ImportResult,
  Restored,
} from "@contract/memory";
import type { InvalidInput, NotFound, Result } from "@contract/result";

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
export type Metadata = Record<string, unknown>;

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

export interface MemoryCore {
  remember: (
    input: { fragment: string },
    by: Author
  ) => Result<Fragment, InvalidInput>;
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
    cursor?: string | undefined;
    tag?: string[] | undefined;
  }) => FragmentPage;
  history: (input: { ref: string }) => Result<History, NotFound>;
  activity: (input: { cursor?: string | undefined }) => ActivityPage;
  forgotten: () => ForgottenList;

  search: (terms: string[]) => SearchHit[];
  associated: (keys: string[]) => Association[];
  anchors: () => AnchorCount[];
  count: () => number;
  snapshot: () => Fragment[];

  readMetadata: (key: string) => Metadata | null;
  patchMetadata: (key: string, patch: Metadata) => Metadata;
}

export type Memory = {
  [K in keyof MemoryCore]: (
    ...args: Parameters<MemoryCore[K]>
  ) => Promise<ReturnType<MemoryCore[K]>>;
};
