// Length rules shared by the worker and client. Core's ceiling and the owner's limits
// must count the same way, so both import this one definition.

// Absolute ceiling enforced by core; the owner's limits live in settings.
export const FRAGMENT_MAX = 1000;

const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

// Length is measured in Unicode grapheme clusters everywhere.
export const fragmentLength = (value: string) =>
  [...segmenter.segment(value)].length;
