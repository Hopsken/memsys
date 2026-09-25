import { stem } from "porter2";

import type { Fragment } from "../contract/memory";

// Function words that carry no cue. Kept short: a missed stopword costs one
// unmatched term, a wrong one makes a real term unsearchable.
const STOPWORDS = new Set(
  "a an and are as at be by for from how in into is it its of on or that the this to was were what when where which with"
    .split(" ")
    .filter(Boolean)
);

const segmenter = new Intl.Segmenter("en", { granularity: "word" });

// Unicode words, lowercased; possessives dropped and plain English words
// stemmed, so "evicted", "eviction", and "D1's" meet "evict" and "d1".
// Anchors are words too: "#durable-objects" yields "durable" and "objects".
export const terms = (text: string): string[] =>
  [...segmenter.segment(text.toLowerCase().replaceAll(/['’]s(?!\p{L})/gu, ""))]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment)
    .filter((word) => !STOPWORDS.has(word))
    .map((word) => (/^[a-z]+$/u.test(word) ? stem(word) : word));

// Fragments are replaced, never mutated, so each object's terms are fixed.
const cache = new WeakMap<Fragment, string[]>();
const fragmentTerms = (item: Fragment) => {
  let cached = cache.get(item);
  if (!cached) {
    cached = terms(item.fragment);
    cache.set(item, cached);
  }
  return cached;
};

const K1 = 1.2;
const B = 0.75;

export interface Scored {
  item: Fragment;
  // Distinct cue terms the fragment contains.
  matched: number;
  score: number;
}

// Okapi BM25 over the whole corpus for each fragment sharing a cue term.
export const bm25 = (corpus: readonly Fragment[], cue: string[]): Scored[] => {
  const query = [...new Set(cue)];
  const docs = corpus.map((item) => ({ item, words: fragmentTerms(item) }));
  const average =
    docs.reduce((sum, doc) => sum + doc.words.length, 0) /
    Math.max(docs.length, 1);
  const df = new Map(
    query.map((term) => [
      term,
      docs.filter((doc) => doc.words.includes(term)).length,
    ])
  );
  const idf = (term: string) => {
    const n = df.get(term) ?? 0;
    return Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
  };
  return docs.flatMap(({ item, words }) => {
    let matched = 0;
    let score = 0;
    for (const term of query) {
      const tf = words.filter((word) => word === term).length;
      if (tf > 0) {
        matched += 1;
        score +=
          (idf(term) * tf * (K1 + 1)) /
          (tf + K1 * (1 - B + (B * words.length) / average));
      }
    }
    return matched > 0 ? [{ item, matched, score }] : [];
  });
};
