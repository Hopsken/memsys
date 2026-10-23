import { stem } from "porter2";

import type { Fragment } from "../../contract/memory";
import type { RecallStage } from "../../contract/plugin";

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

// Fragments are stored in no order; stages that walk the corpus list it
// newest first so ties keep recency.
export const newestFirst = (corpus: Iterable<Fragment>) =>
  [...corpus].toSorted(
    (a, b) => b.at.localeCompare(a.at) || a.ref.localeCompare(b.ref)
  );

const normalize = (text: string): string =>
  text.toLowerCase().replaceAll(/\s+/gu, " ").trim();

// Built-in stage: adds the fragments that match the cue, best first.
export const match: RecallStage<null> = ({ corpus }, items, { cue }) => {
  const ordered = newestFirst(corpus.values());
  const normalizedCue = normalize(cue);
  const cueTerms = [...new Set(terms(cue))];
  // Every cue term must appear; a cue of three or more terms may miss one.
  const required = cueTerms.length >= 3 ? cueTerms.length - 1 : cueTerms.length;
  const scored = new Map(
    bm25(ordered, cueTerms).map((entry) => [entry.item.ref, entry])
  );
  // Phrase matches first, then by terms matched and BM25; ties stay newest first.
  const matches = ordered
    .map((item) => ({
      item,
      matched: scored.get(item.ref)?.matched ?? 0,
      phrase: normalize(item.fragment).includes(normalizedCue),
      score: scored.get(item.ref)?.score ?? 0,
    }))
    .filter(
      ({ matched, phrase }) =>
        phrase || (cueTerms.length > 0 && matched >= required)
    )
    .toSorted(
      (a, b) =>
        Number(b.phrase) - Number(a.phrase) ||
        b.matched - a.matched ||
        b.score - a.score
    )
    .map(({ item }) => ({ ref: item.ref }));
  return Promise.resolve({ items: [...items, ...matches] });
};
