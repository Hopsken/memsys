import { stem } from "porter2";

const STOPWORDS = new Set(
  "a an and are as at be by for from how in into is it its of on or that the this to was were what when where which with"
    .split(" ")
    .filter(Boolean)
);

const segmenter = new Intl.Segmenter("en", { granularity: "word" });

const POSSESSIVE = /['’]s(?!\p{L})/gu;

export const stemPlainEnglish = (word: string) =>
  /^[a-z]+$/u.test(word) ? stem(word) : word;

export const terms = (text: string): string[] =>
  [...segmenter.segment(text.toLowerCase().replaceAll(POSSESSIVE, ""))]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment)
    .filter((word) => !STOPWORDS.has(word))
    .map(stemPlainEnglish);
