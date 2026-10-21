// Turns per-question verdicts into results.md: accuracy, and for each wrong
// answer the stage where it went wrong.

import { z } from "zod";

export const recallArgs = z.looseObject({
  context: z.string().nullish(),
  cue: z.string(),
});

export const verdict = z.object({
  abstain: z.boolean(),
  answer: z.string(),
  correct: z.boolean(),
  cost: z.number(),
  // The arguments of every recall call while answering.
  cues: z.array(recallArgs),
  // Current memories the answer needs, labeled by a model.
  evidence: z.array(z.string()),
  // Of those, the ones some recall returned.
  evidenceReturned: z.array(z.string()),
  expected: z.string(),
  fingerprint: z.string(),
  memories: z.number(),
  piErrors: z.number(),
  question: z.string(),
  questionId: z.string(),
  type: z.string(),
  // remember, revise, and forget calls while reading sessions.
  writes: z.number(),
});
export type Verdict = z.infer<typeof verdict>;

// Where a wrong answer went wrong, in pipeline order.
export type Stage =
  | "correct"
  // Memory holds nothing the answer needs.
  | "not written"
  // The agent answered without calling recall.
  | "not recalled"
  // It recalled, but no needed memory came back.
  | "not retrieved"
  // Some needed memory came back, but not all of it.
  | "partly retrieved"
  // Every needed memory came back; the answer is still wrong.
  | "not used";

export const stage = (v: Verdict): Stage => {
  if (v.correct) {
    return "correct";
  }
  if (v.abstain || v.evidence.length === 0) {
    // An abstention question has no evidence: a wrong answer there is the
    // model claiming to know, whatever recall did.
    return v.abstain ? "not used" : "not written";
  }
  if (v.cues.length === 0) {
    return "not recalled";
  }
  if (v.evidenceReturned.length === 0) {
    return "not retrieved";
  }
  return v.evidenceReturned.length < v.evidence.length
    ? "partly retrieved"
    : "not used";
};

const STAGES: Stage[] = [
  "correct",
  "not written",
  "not recalled",
  "not retrieved",
  "partly retrieved",
  "not used",
];

const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
const table = (head: string[], rows: (string | number)[][]) =>
  [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
const percent = (part: number, whole: number) =>
  whole === 0 ? "—" : `${((100 * part) / whole).toFixed(0)}%`;
const oneLine = (text: string, max = 160) => {
  const flat = text.replaceAll(/\s+/gu, " ").replaceAll("|", "\\|").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

export const report = (
  verdicts: Verdict[],
  meta: { model: string; run: string; thinking: string }
) => {
  const sorted = verdicts.toSorted((a, b) =>
    a.questionId.localeCompare(b.questionId)
  );
  const byType = Object.groupBy(sorted, (v) => v.type);
  const count = (items: Verdict[], s: Stage) =>
    items.filter((v) => stage(v) === s).length;
  const correct = sorted.filter((v) => v.correct).length;
  const cost = sorted.reduce((sum, v) => sum + v.cost, 0);
  const fingerprints = [...new Set(sorted.map((v) => v.fingerprint))];
  return `# LongMemEval through Pi

Run \`${meta.run}\`: ${sorted.length} questions from LongMemEval_S, model \`${meta.model}\` (thinking \`${meta.thinking}\`, fingerprint ${fingerprints.map((f) => `\`${f}\``).join(", ")}). Accuracy ${percent(correct, sorted.length)} (${correct}/${sorted.length}); cost $${cost.toFixed(2)}. Regenerate with \`node eval/longmemeval/run.ts --run ${meta.run}\`.

## Where answers went wrong

Evidence is the memories a model judged the answer to need. Stages, in order: nothing needed was written; the agent did not recall; recall returned none of it; recall returned some of it; everything needed came back and the answer is still wrong (for abstention questions, any wrong answer).

${table(
  ["Type", "Questions", ...STAGES],
  [
    ...Object.entries(byType).map(([type, items = []]) => [
      type,
      items.length,
      ...STAGES.map((s) => count(items, s)),
    ]),
    ["**all**", sorted.length, ...STAGES.map((s) => count(sorted, s))],
  ]
)}

## Write and read

${table(
  [
    "Type",
    "Memories / question",
    "Writes / question",
    "Recalls / question",
    "Pi errors",
  ],
  Object.entries(byType).map(([type, items = []]) => [
    type,
    (items.reduce((sum, v) => sum + v.memories, 0) / items.length).toFixed(0),
    (items.reduce((sum, v) => sum + v.writes, 0) / items.length).toFixed(0),
    (items.reduce((sum, v) => sum + v.cues.length, 0) / items.length).toFixed(
      1
    ),
    items.reduce((sum, v) => sum + v.piErrors, 0),
  ])
)}

## Per question

${table(
  [
    "Question",
    "Type",
    "Stage",
    "Evidence returned",
    "Cues",
    "Question text",
    "Expected",
    "Answer",
  ],
  sorted.map((v) => [
    v.questionId,
    v.type,
    stage(v),
    `${v.evidenceReturned.length}/${v.evidence.length}`,
    oneLine(v.cues.map(({ cue }) => `\`${cue}\``).join(", "), 120),
    oneLine(v.question, 100),
    oneLine(v.expected, 80),
    oneLine(v.answer),
  ])
)}
`;
};
