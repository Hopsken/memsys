import type {
  ActivityPage,
  Author,
  ForgottenList,
  Fragment,
  FragmentPage,
  History,
  ImportFormat,
  ImportResult,
  JsonObject,
  Restored,
} from "../contract/memory";
import type { InvalidInput, NotFound, Result } from "../contract/result";

export interface SearchHit {
  fragment: Fragment;
  // How well the fragment matches the terms; higher is better.
  score: number;
  // The query terms the fragment contains.
  matched: string[];
}

export interface Association {
  fragment: Fragment;
  // The fragment's anchors whose association key was asked for.
  via: string[];
}

export interface AnchorCount {
  anchor: string;
  // Current fragments carrying the anchor.
  fragments: number;
}

// One fragment of the development corpus, written at noon on `date`.
export interface SeedFragment {
  date: string;
  fragment: string;
}

// The whole surface an app may use (RFC 0004). Writes run core validation
// only; scoring is the core's, deciding what is relevant is the app's.
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

  // Untyped JSON documents by key, kept beside the memory; the core never
  // reads them.
  readMetadata: (key: string) => JsonObject | null;
  // Applies a JSON Merge Patch (RFC 7396) and returns the merged document.
  patchMetadata: (key: string, patch: JsonObject) => JsonObject;
}

// The core as an app holds it: the Durable Object's stub, where every call
// is async over RPC, or an index in the same isolate in tests and the eval.
export type Memory = {
  [K in keyof MemoryCore]: (
    ...args: Parameters<MemoryCore[K]>
  ) => ReturnType<MemoryCore[K]> | Promise<ReturnType<MemoryCore[K]>>;
};
