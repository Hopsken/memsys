import { z } from "zod";

import { BUDGET_REASON } from "./budget.ts";
import { requiredSessions } from "./corpus.ts";
import type { Labels } from "./corpus.ts";
import type { SlimQuestion } from "./dataset.ts";
import { CORRECT, UNSURE } from "./jev.ts";
import { READ_TOOLS } from "./pi.ts";
import type { PiRun, ToolCall } from "./pi.ts";
import type { SettingsMergePatch } from "./server.ts";

const recalledSchema = z.object({
  fragments: z.array(z.looseObject({ fragment: z.string(), ref: z.string() })),
});
const recallArgsSchema = z.looseObject({
  context: z.string().nullish(),
  cue: z.string(),
});

export const roundSchema = z.object({
  cue: z.string(),
  evidence: z.array(z.string()),
  returned: z.number(),
});

export const scoreSchema = z.object({
  answer: z.number(),
  answerText: z.string(),
  cost: z.number(),
  error: z.string().optional(),
  found: z.boolean(),
  foundAt: z.number(),
  id: z.string(),
  read: z.number(),
  readTokens: z.number(),
  repeat: z.number(),
  rounds: z.array(roundSchema),
  stale: z.number(),
  type: z.string(),
  writeMiss: z.boolean(),
});
export type Score = z.infer<typeof scoreSchema>;

const isBlocked = (tool: ToolCall) =>
  tool.isError && tool.result.includes(BUDGET_REASON);

export const scoreRun = (
  q: SlimQuestion,
  run: PiRun,
  repeat: number,
  labelsOf: Labels[string] | undefined,
  answer: number
): Score => {
  const required = requiredSessions(q);
  const labeled = (index: number) => new Set(labelsOf?.[index]);
  const evidenceRefs = new Set(
    q.evidence.flatMap((s) => labelsOf?.[s.index] ?? [])
  );
  const staleRefs = new Set<string>();
  if (q.type === "knowledge-update") {
    const current = labeled(q.evidence.at(-1)?.index ?? -1);
    for (const s of q.evidence.slice(0, -1)) {
      for (const ref of labelsOf?.[s.index] ?? []) {
        if (!current.has(ref)) {
          staleRefs.add(ref);
        }
      }
    }
  }
  const escaped = run.tools.find(
    (tool) => !tool.isError && !READ_TOOLS.has(tool.name)
  );
  const rounds = run.tools
    .filter((tool) => tool.name === "recall" && !isBlocked(tool))
    .map((tool) => {
      const fragments = tool.isError
        ? []
        : recalledSchema.parse(JSON.parse(tool.result)).fragments;
      return {
        cue: recallArgsSchema.safeParse(tool.args).data?.cue ?? "",
        evidence: fragments
          .map((f) => f.ref)
          .filter((ref) => evidenceRefs.has(ref)),
        fragments,
        returned: fragments.length,
      };
    });
  const seen = new Set<string>();
  let foundAt = 0;
  for (const [k, r] of rounds.entries()) {
    for (const ref of r.evidence) {
      seen.add(ref);
    }
    if (
      foundAt === 0 &&
      required.every((i) => [...labeled(i)].some((ref) => seen.has(ref)))
    ) {
      foundAt = k + 1;
    }
  }
  const returned = rounds.flatMap((r) => r.fragments);
  const writeMiss = required.some((i) => labeled(i).size === 0);
  const found = foundAt > 0 && required.length > 0;
  return {
    answer,
    answerText: run.answer,
    cost: run.cost,
    ...((run.error ?? escaped) && {
      error: run.error ?? `ran tool ${escaped?.name ?? ""}`,
    }),
    found,
    foundAt,
    id: q.id,
    read: returned.length,
    readTokens: Math.round(
      returned.reduce((sum, f) => sum + f.fragment.length, 0) / 4
    ),
    repeat,
    rounds: rounds.map(({ cue, evidence, returned: n }) => ({
      cue,
      evidence,
      returned: n,
    })),
    stale: returned.filter((f) => staleRefs.has(f.ref)).length,
    type: q.type,
    writeMiss,
  };
};

const row = (cells: (number | string)[]) => `| ${cells.join(" | ")} |`;
const table = (head: string[], rows: (number | string)[][]) =>
  [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
const percent = (part: number, whole: number) =>
  whole === 0 ? "—" : `${((100 * part) / whole).toFixed(0)}%`;
const range = (values: number[]) => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? String(min) : `${min}–${max}`;
};
const mean = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, v) => sum + v, 0) / values.length;
const oneLine = (text: string, max: number) => {
  const flat = text.replaceAll(/\s+/gu, " ").replaceAll("|", "\\|").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

export interface RunMeta {
  corpus: string;
  corpusSize: Record<string, number>;
  model: string;
  settings: SettingsMergePatch;
  recallRounds: number;
  repeats: number;
  run: string;
  thinking: string;
}

export const report = (
  questions: SlimQuestion[],
  scores: Score[],
  meta: RunMeta
) => {
  const byId = Map.groupBy(scores, (s) => s.id);
  const groups = questions
    .map((q) => ({ q, runs: byId.get(q.id) ?? [] }))
    .filter(({ runs }) => runs.length > 0);
  const scorable = groups.filter(
    ({ q, runs }) =>
      !q.abstain && !runs.some((s) => s.writeMiss || s.error !== undefined)
  );
  const writeMisses = groups.filter(({ runs }) =>
    runs.some((s) => s.writeMiss)
  );
  const errored = groups.filter(({ runs }) => runs.some((s) => s.error));
  const ks = Array.from({ length: meta.recallRounds }, (_, k) => k + 1);
  const summary = (items: typeof scorable) => {
    const runs = items.flatMap(({ runs: r }) => r);
    const dump = items.reduce(
      (sum, { q }) => sum + (meta.corpusSize[q.id] ?? 0),
      0
    );
    return [
      items.length,
      ...ks.map((k) =>
        percent(
          runs.filter((s) => s.found && s.foundAt <= k).length,
          runs.length
        )
      ),
      mean(runs.map((s) => s.read)).toFixed(1),
      (dump / Math.max(items.length, 1)).toFixed(0),
      mean(runs.map((s) => s.readTokens)).toFixed(0),
      mean(runs.map((s) => s.rounds.length)).toFixed(1),
      `${percent(runs.filter((s) => s.answer >= CORRECT).length, runs.length)}`,
    ];
  };
  const byType = Object.entries(Object.groupBy(scorable, ({ q }) => q.type));
  const allRuns = groups.flatMap(({ runs }) => runs);
  const cost = allRuns.reduce((sum, s) => sum + s.cost, 0);
  const unsure = allRuns.filter(
    (s) => s.answer >= UNSURE.low && s.answer < UNSURE.high
  );
  const ku = scorable.filter(({ q }) => q.type === "knowledge-update");
  const kuRuns = ku.flatMap(({ runs }) => runs);
  const abstain = groups.filter(({ q }) => q.abstain);
  const abstainRuns = abstain.flatMap(({ runs }) => runs);

  return `# Recall run \`${meta.run}\`

Corpus \`${meta.corpus}\`, model \`${meta.model}\` (thinking \`${meta.thinking}\`), ${meta.repeats} repeats per question, recall budget ${meta.recallRounds} rounds, settings ${Object.keys(meta.settings).length === 0 ? "at their defaults" : `\`${JSON.stringify(meta.settings)}\` (the rest at their defaults)`}. ${groups.length} questions, ${allRuns.length} conversations, $${cost.toFixed(3)}. Regenerate with \`node eval/longmemeval/recall.ts --corpus ${meta.corpus} --run ${meta.run}\`.

Recall is scored on ${scorable.length} questions. Left out: ${abstain.length} abstention questions (nothing to find; their answers are graded below), ${writeMisses.length} write misses (a required evidence session has no answer-bearing fragment in the corpus: ${writeMisses.map(({ q }) => q.id).join(", ") || "none"}), ${errored.length} with a failed conversation (${errored.map(({ q }) => q.id).join(", ") || "none"}).

## Recall

**found@k**: every required evidence session had an answer-bearing fragment among what recall returned in the first k rounds. **read**: fragments returned per conversation; **dump** is the fragments in the corpus, what reading everything would cost. **rounds**: recall calls per conversation, at most ${meta.recallRounds}. **answer**: LongMemEval correctness by Jev, secondary.

${table(
  [
    "Type",
    "Questions",
    ...ks.map((k) => `found@${k}`),
    "read",
    "dump",
    "≈tokens",
    "rounds",
    "answer",
  ],
  [
    ...byType.map(([type, items = []]) => [type, ...summary(items)]),
    ["**all**", ...summary(scorable)],
  ]
)}

${
  ku.length > 0
    ? `Knowledge-update: ${kuRuns.reduce((sum, s) => sum + s.stale, 0)} stale fragments (a replaced value) returned over ${kuRuns.length} conversations.\n`
    : ""
}${
    abstain.length > 0
      ? `Abstention: ${abstainRuns.filter((s) => s.answer >= CORRECT).length}/${abstainRuns.length} conversations declined correctly, reading ${mean(abstainRuns.map((s) => s.read)).toFixed(1)} fragments in ${mean(abstainRuns.map((s) => s.rounds.length)).toFixed(1)} rounds on average.\n`
      : ""
  }
Answers scored between ${UNSURE.low} and ${UNSURE.high} by Jev, worth a look: ${unsure.length}${unsure.length > 0 ? ` (${[...new Set(unsure.map((s) => s.id))].join(", ")})` : ""}.

## Per question

Repeats are shown as a range. **found** and **answer** count repeats.

${table(
  [
    "Question",
    "Type",
    "found",
    "at round",
    "rounds",
    "read",
    "dump",
    "answer",
    "Flags",
    "Cues (first repeat)",
  ],
  groups.map(({ q, runs }) => [
    q.id,
    q.type,
    q.abstain ? "—" : `${runs.filter((s) => s.found).length}/${runs.length}`,
    q.abstain ? "—" : range(runs.map((s) => s.foundAt)),
    range(runs.map((s) => s.rounds.length)),
    range(runs.map((s) => s.read)),
    meta.corpusSize[q.id] ?? 0,
    `${runs.filter((s) => s.answer >= CORRECT).length}/${runs.length}`,
    [
      runs.some((s) => s.writeMiss) && "write miss",
      runs.some((s) => s.stale > 0) && "stale",
      runs.some((s) => s.error) && "error",
    ]
      .filter(Boolean)
      .join(", "),
    oneLine(
      (runs.find((s) => s.repeat === 1)?.rounds ?? [])
        .map((r) => `\`${r.cue}\``)
        .join(", "),
      120
    ),
  ])
)}
`;
};
