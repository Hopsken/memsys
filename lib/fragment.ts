// Length rules shared by core and plugins. Core's ceiling and a plugin's limit
// must count the same way, so both import this one definition.

// Absolute ceiling enforced by core; per-instance limits live in plugins.
export const FRAGMENT_MAX = 1000;

const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

// Length is measured in Unicode grapheme clusters everywhere.
export const fragmentLength = (value: string) =>
  [...segmenter.segment(value)].length;
