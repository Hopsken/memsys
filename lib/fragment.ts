export const FRAGMENT_MAX = 1000;

const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

export const fragmentLength = (value: string) =>
  [...segmenter.segment(value)].length;
