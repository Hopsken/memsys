import type { Fragment, JsonObject } from "@contract/memory";
import { terms } from "@lib/analyzer";
import { associationKeys, extractAnchors } from "@lib/anchor";

import type { AnchorCount, Association, MemoryCore, SearchHit } from "./api";

const K1 = 1.2;
const B = 0.75;

const newestFirst = (a: Fragment, b: Fragment) =>
  b.at.localeCompare(a.at) || a.ref.localeCompare(b.ref);

export class FragmentIndex {
  private readonly fragments = new Map<string, Fragment>();
  private readonly postings = new Map<string, Map<string, number>>();
  private readonly lengths = new Map<string, number>();
  private totalLength = 0;
  private readonly anchorsOf = new Map<string, string[]>();
  private readonly byKey = new Map<string, Set<string>>();
  private readonly anchorCounts = new Map<string, number>();

  constructor(fragments: Iterable<Fragment> = []) {
    for (const fragment of fragments) {
      this.set(fragment);
    }
  }

  get size() {
    return this.fragments.size;
  }

  get(ref: string) {
    return this.fragments.get(ref);
  }

  has(ref: string) {
    return this.fragments.has(ref);
  }

  values() {
    return this.fragments.values();
  }

  set(fragment: Fragment) {
    this.delete(fragment.ref);
    const { ref } = fragment;
    this.fragments.set(ref, fragment);
    const words = terms(fragment.fragment);
    this.lengths.set(ref, words.length);
    this.totalLength += words.length;
    for (const word of words) {
      let posting = this.postings.get(word);
      if (!posting) {
        posting = new Map();
        this.postings.set(word, posting);
      }
      posting.set(ref, (posting.get(ref) ?? 0) + 1);
    }
    const anchors = extractAnchors(fragment.fragment);
    this.anchorsOf.set(ref, anchors);
    for (const anchor of anchors) {
      this.anchorCounts.set(anchor, (this.anchorCounts.get(anchor) ?? 0) + 1);
      for (const key of associationKeys(anchor)) {
        let refs = this.byKey.get(key);
        if (!refs) {
          refs = new Set();
          this.byKey.set(key, refs);
        }
        refs.add(ref);
      }
    }
  }

  delete(ref: string) {
    const fragment = this.fragments.get(ref);
    if (!fragment) {
      return;
    }
    this.fragments.delete(ref);
    this.totalLength -= this.lengths.get(ref) ?? 0;
    this.lengths.delete(ref);
    for (const word of new Set(terms(fragment.fragment))) {
      const posting = this.postings.get(word);
      posting?.delete(ref);
      if (posting?.size === 0) {
        this.postings.delete(word);
      }
    }
    for (const anchor of this.anchorsOf.get(ref) ?? []) {
      const count = (this.anchorCounts.get(anchor) ?? 1) - 1;
      if (count === 0) {
        this.anchorCounts.delete(anchor);
      } else {
        this.anchorCounts.set(anchor, count);
      }
      for (const key of associationKeys(anchor)) {
        const refs = this.byKey.get(key);
        refs?.delete(ref);
        if (refs?.size === 0) {
          this.byKey.delete(key);
        }
      }
    }
    this.anchorsOf.delete(ref);
  }

  clear() {
    for (const ref of this.fragments.keys()) {
      this.delete(ref);
    }
  }

  private current(refs: Iterable<string>): Fragment[] {
    return [...refs].flatMap((ref) => {
      const fragment = this.fragments.get(ref);
      return fragment ? [fragment] : [];
    });
  }

  search(query: readonly string[]): SearchHit[] {
    const unique = [...new Set(query)];
    const n = this.fragments.size;
    const average = this.totalLength / Math.max(n, 1);
    const idf = (term: string) => {
      const df = this.postings.get(term)?.size ?? 0;
      return Math.log(1 + (n - df + 0.5) / (df + 0.5));
    };
    const refs = new Set(
      unique.flatMap((term) => [...(this.postings.get(term)?.keys() ?? [])])
    );
    return this.current(refs)
      .map((fragment) => {
        const { ref } = fragment;
        const length = this.lengths.get(ref) ?? 0;
        const matched: string[] = [];
        let score = 0;
        for (const term of unique) {
          const tf = this.postings.get(term)?.get(ref) ?? 0;
          if (tf > 0) {
            matched.push(term);
            score +=
              (idf(term) * tf * (K1 + 1)) /
              (tf + K1 * (1 - B + (B * length) / average));
          }
        }
        return { fragment, matched, score };
      })
      .toSorted(
        (a, b) => b.score - a.score || newestFirst(a.fragment, b.fragment)
      );
  }

  associated(keys: readonly string[]): Association[] {
    const wanted = new Set(keys);
    const refs = new Set(
      [...wanted].flatMap((key) => [...(this.byKey.get(key) ?? [])])
    );
    return this.current(refs)
      .toSorted(newestFirst)
      .map((fragment) => ({
        fragment,
        via: (this.anchorsOf.get(fragment.ref) ?? []).filter((anchor) =>
          associationKeys(anchor).some((key) => wanted.has(key))
        ),
      }));
  }

  anchors(): AnchorCount[] {
    return [...this.anchorCounts.keys()].toSorted().map((anchor) => ({
      anchor,
      fragments: this.anchorCounts.get(anchor) ?? 0,
    }));
  }
}

export const inMemory = (
  fragments: Iterable<Fragment>,
  metadata: Record<string, JsonObject> = {}
) => {
  const index = new FragmentIndex(fragments);
  return {
    anchors: () => index.anchors(),
    associated: (keys: string[]) => index.associated(keys),
    count: () => index.size,
    readMetadata: (key: string) => metadata[key] ?? null,
    search: (query: string[]) => index.search(query),
  } satisfies Partial<MemoryCore>;
};
