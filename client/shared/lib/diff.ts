// Word-level diff between two versions of a memory. Memories are short, so a
// plain LCS table is fast enough.

export interface Part {
  kind: "added" | "removed" | "same";
  text: string;
}

// Word segments split CJK text too, where there are no spaces to split on.
const segmenter = new Intl.Segmenter("und", { granularity: "word" });

const tokens = (text: string) =>
  [...segmenter.segment(text)].map(({ segment }) => segment);

const isSpace = (text: string) => text.trim() === "";

// Below this share of unchanged text, a diff is harder to read than the text.
const MIN_SAME = 0.5;

const walk = (before: string[], after: string[]): Part[] => {
  const rows = before.length;
  const cols = after.length;
  // table[i][j]: longest common run of before[i..] and after[j..], flattened.
  const table = new Uint16Array((rows + 1) * (cols + 1));
  const cell = (i: number, j: number) => table[i * (cols + 1) + j] ?? 0;
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i * (cols + 1) + j] =
        before[i] === after[j]
          ? cell(i + 1, j + 1) + 1
          : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }
  const parts: Part[] = [];
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    const removed = before[i];
    const added = after[j];
    if (removed !== undefined && removed === added) {
      parts.push({ kind: "same", text: removed });
      i += 1;
      j += 1;
    } else if (
      removed !== undefined &&
      (added === undefined || cell(i + 1, j) >= cell(i, j + 1))
    ) {
      parts.push({ kind: "removed", text: removed });
      i += 1;
    } else {
      parts.push({ kind: "added", text: added ?? "" });
      j += 1;
    }
  }
  return parts;
};

// Within each run of changes, removed text comes before added text, and a
// space between two changes joins them rather than splitting the run. A side
// that changed only spaces is dropped, so the run shows as a pure addition or
// removal.
const group = (parts: Part[]): Part[] => {
  const grouped: Part[] = [];
  let removed = "";
  let added = "";
  const flush = () => {
    if (!isSpace(removed)) {
      grouped.push({ kind: "removed", text: removed });
    }
    if (!isSpace(added)) {
      grouped.push({ kind: "added", text: added });
    }
    removed = "";
    added = "";
  };
  for (const [index, part] of parts.entries()) {
    const inRun = removed !== "" || added !== "";
    const next = parts[index + 1];
    if (part.kind === "removed") {
      removed += part.text;
    } else if (part.kind === "added") {
      added += part.text;
    } else if (inRun && isSpace(part.text) && next && next.kind !== "same") {
      removed += part.text;
      added += part.text;
    } else {
      flush();
      const last = grouped.at(-1);
      if (last?.kind === "same") {
        last.text += part.text;
      } else {
        grouped.push({ ...part });
      }
    }
  }
  flush();
  return grouped;
};

const visible = (text: string) => text.replaceAll(/\s/gu, "").length;

// Null when too little is unchanged for a diff to help.
export const diffWords = (before: string, after: string): Part[] | null => {
  const parts = group(walk(tokens(before), tokens(after)));
  const same = parts
    .filter(({ kind }) => kind === "same")
    .reduce((sum, { text }) => sum + visible(text), 0);
  const shorter = Math.min(visible(before), visible(after));
  return same < shorter * MIN_SAME ? null : parts;
};
