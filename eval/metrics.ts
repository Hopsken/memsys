import type { EvalCase, Kind } from "./dataset";

export interface Outcome {
  case: EvalCase;
  // Returned refs, in order, after truncation.
  refs: string[];
}

export interface Score {
  found: number;
  // Returned items that are neither hits nor ok.
  noise: number;
  // null when the case has no hits (abstain).
  ndcg: number | null;
  recall: number | null;
  rr: number | null;
}

const gain = (rank: number) => 1 / Math.log2(rank + 2);

export const score = ({ case: { hits, ok = [] }, refs }: Outcome): Score => {
  const relevant = new Set(hits);
  const acceptable = new Set([...hits, ...ok]);
  const found = refs.filter((ref) => relevant.has(ref)).length;
  const first = refs.findIndex((ref) => relevant.has(ref));
  const dcg = refs
    .slice(0, 10)
    .reduce((sum, ref, rank) => sum + (relevant.has(ref) ? gain(rank) : 0), 0);
  const ideal = hits.slice(0, 10).reduce((sum, _, rank) => sum + gain(rank), 0);
  const graded = hits.length > 0;
  const rank = first === -1 ? 0 : 1 / (first + 1);
  return {
    found,
    ndcg: graded ? dcg / ideal : null,
    noise: refs.filter((ref) => !acceptable.has(ref)).length,
    recall: graded ? found / hits.length : null,
    rr: graded ? rank : null,
  };
};

const mean = (values: (number | null)[]) => {
  const present = values.filter((value) => value !== null);
  return present.length > 0
    ? present.reduce((sum, value) => sum + value, 0) / present.length
    : null;
};

const fixed = (value: number | null, digits = 2) =>
  value === null ? "—" : value.toFixed(digits);

export interface Run {
  name: string;
  outcomes: Outcome[];
  // Cases where a plugin hook still failed after retries.
  failures: number;
}

const kinds: Kind[] = [
  "exact",
  "scattered",
  "morphology",
  "partial",
  "association",
  "multi",
  "semantic",
  "abstain",
];

const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
const table = (head: string[], rows: string[][]) =>
  [
    row(head),
    row(head.map(() => "---")),
    ...rows.map((cells) => row(cells)),
  ].join("\n");

export const report = (runs: Run[], header: string) => {
  const scored = runs.map((run) => ({
    ...run,
    scores: run.outcomes.map((outcome) => ({
      kind: outcome.case.kind,
      outcome,
      score: score(outcome),
    })),
  }));
  const summary = table(
    [
      "Setup",
      "Recall@10",
      "nDCG@10",
      "MRR",
      "Noise / cue",
      "Returned / cue",
      "Clean abstain",
      "Hook failures",
    ],
    scored.map(({ failures, name, scores }) => {
      const abstain = scores.filter((item) => item.kind === "abstain");
      return [
        name,
        fixed(mean(scores.map((item) => item.score.recall))),
        fixed(mean(scores.map((item) => item.score.ndcg))),
        fixed(mean(scores.map((item) => item.score.rr))),
        fixed(mean(scores.map((item) => item.score.noise)), 1),
        fixed(mean(scores.map((item) => item.outcome.refs.length)), 1),
        `${abstain.filter((item) => item.score.noise === 0).length}/${abstain.length}`,
        String(failures),
      ];
    })
  );
  const byKind = table(
    ["Kind (cues)", ...scored.map((run) => run.name)],
    kinds.map((kind) => [
      `${kind} (${runs[0]?.outcomes.filter((outcome) => outcome.case.kind === kind).length ?? 0})`,
      ...scored.map(({ scores }) => {
        const items = scores.filter((item) => item.kind === kind);
        return `${fixed(mean(items.map((item) => item.score.recall)))} / ${fixed(mean(items.map((item) => item.score.noise)), 1)}`;
      }),
    ])
  );
  const perCase = table(
    ["Case", "Kind", "Cue", ...scored.map((run) => run.name)],
    (runs[0]?.outcomes ?? []).map(({ case: item }, index) => [
      item.id,
      item.kind,
      `\`${item.cue}\``,
      ...scored.map(({ scores }) => {
        const entry = scores[index];
        return entry
          ? `${entry.score.found}/${item.hits.length} +${entry.score.noise}`
          : "";
      }),
    ])
  );
  return `${header}

## Summary

Recall, nDCG, and MRR average over cues with hits; noise counts returned items that are neither hits nor marked ok.

${summary}

## By kind (recall / noise per cue)

${byKind}

## Per case (hits found / hits, +noise)

${perCase}
`;
};
