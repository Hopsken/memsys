import { stem } from "porter2";

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
