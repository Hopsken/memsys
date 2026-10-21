// Checks whether Jev can replace the DeepSeek judge: grades every answer a
// run already has (memsys and full context) with Jev, and compares the two
// judges answer by answer. Bills Workers AI through a remote binding.
//
//   node eval/longmemeval/jev-judge.ts --run baseline-1021
//
// Writes runs/<run>/jev-judge.json (scores) and jev-judge.md (agreement).

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { getPlatformProxy } from "wrangler";
import { z } from "zod";

import { loadQuestions } from "./dataset.ts";
import type { Question } from "./dataset.ts";
import { verdict } from "./report.ts";

const { values: args } = parseArgs({
  options: {
    run: { type: "string" },
    threshold: { default: "0.5", type: "string" },
  },
});
const RUN = args.run;
if (RUN === undefined) {
  throw new Error("Name the run to regrade: --run <name>");
}
const RUN_DIR = path.join(import.meta.dirname, "runs", RUN);
const THRESHOLD = Number(args.threshold);
const ATTEMPTS = 3;
const CONCURRENCY = 4;

// LongMemEval's grading rules (src/evaluation/evaluate_qa.py), restated as
// Jev criteria.
const criteria = (q: Question) => {
  if (q.question_id.endsWith("_abs")) {
    return {
      false:
        "The response answers the question as if the information were known.",
      true: "The response says the question cannot be answered: the information is missing or incomplete, or what is known differs from what the question assumes.",
    };
  }
  const wrong =
    "The response gives a different answer, no answer, or only part of the information the correct answer requires.";
  switch (q.question_type) {
    case "single-session-preference": {
      return {
        false:
          "The response ignores the user's personal information or uses it wrongly.",
        true: "The response satisfies the rubric in `answer`: it recalls and uses the user's personal information correctly. It need not cover every point of the rubric.",
      };
    }
    case "temporal-reasoning": {
      return {
        false: wrong,
        true: "The response contains the correct answer, an equivalent answer, or all the steps to reach it. A count of days, weeks, or months that is off by one still counts as correct.",
      };
    }
    case "knowledge-update": {
      return {
        false: wrong,
        true: "The response gives the updated answer as the current one. Mentioning earlier values as well is fine.",
      };
    }
    default: {
      return {
        false: wrong,
        true: "The response contains the correct answer, an equivalent answer, or all the steps to reach it.",
      };
    }
  }
};

const jevAnswers = z.object({
  answers: z.record(z.string(), z.object({ noul: z.number() })),
});
const jevOutput = z.union([
  jevAnswers,
  z
    .object({ result: jevAnswers.extend({ model: z.string() }) })
    .transform(({ result }) => result),
]);

const proxy = await getPlatformProxy<{ AI: Ai }>({
  configPath: path.join(import.meta.dirname, "..", "wrangler.jsonc"),
  remoteBindings: true,
});

const grade = async (q: Question, response: string) => {
  const input = {
    questions: {
      correct: {
        criteria: criteria(q),
        instructions:
          "Given `question` and its correct answer `answer`, is `response` correct?",
        type: "noul",
      },
    },
    state: { answer: q.answer, question: q.question, response },
  };
  let lastError = "";
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      // Retries are sequential by design.
      // SAFETY: the binding's model union has no entry for Jev; the output
      // is parsed below.
      // oxlint-disable-next-line no-await-in-loop
      const output = await proxy.env.AI.run("typesafe/jev" as never, input);
      const parsed = jevOutput.parse(output);
      const score = parsed.answers["correct"]?.noul;
      if (score !== undefined) {
        return { model: "model" in parsed ? String(parsed.model) : "", score };
      }
      lastError = "no answer";
    } catch (error) {
      lastError = String(error);
    }
  }
  throw new Error(`${q.question_id}: ${lastError}`);
};

const piAnswer = z.object({ answer: z.string() });
const fullAnswer = z.object({ answer: z.string(), correct: z.boolean() });

const read = async <T>(file: string, schema: z.ZodType<T>) =>
  schema.parse(JSON.parse(await readFile(file, "utf-8")));

interface Item {
  deepseek: boolean;
  q: Question;
  response: string;
  setup: "full context" | "memsys";
}

const entries = await readdir(RUN_DIR);
const all = await loadQuestions();
const items: Item[] = [];
for (const q of all.filter((item) => entries.includes(item.question_id))) {
  const dir = path.join(RUN_DIR, q.question_id);
  if (existsSync(path.join(dir, "verdict.json"))) {
    // oxlint-disable-next-line no-await-in-loop
    const [answer, judged] = await Promise.all([
      read(path.join(dir, "answer.json"), piAnswer),
      read(path.join(dir, "verdict.json"), verdict),
    ]);
    items.push({
      deepseek: judged.correct,
      q,
      response: answer.answer,
      setup: "memsys",
    });
  }
  if (existsSync(path.join(dir, "full-context.json"))) {
    // oxlint-disable-next-line no-await-in-loop
    const full = await read(path.join(dir, "full-context.json"), fullAnswer);
    items.push({
      deepseek: full.correct,
      q,
      response: full.answer,
      setup: "full context",
    });
  }
}

const results: (Item & { model: string; score: number })[] = [];
const queue = [...items];
const worker = async () => {
  for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
    // oxlint-disable-next-line no-await-in-loop
    const graded = await grade(item.q, item.response);
    results.push({ ...item, ...graded });
  }
};
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await proxy.dispose();
results.sort(
  (a, b) =>
    a.q.question_id.localeCompare(b.q.question_id) ||
    a.setup.localeCompare(b.setup)
);

const jev = (item: (typeof results)[number]) => item.score >= THRESHOLD;
const agree = results.filter((item) => jev(item) === item.deepseek);
const rate = (group: typeof results) =>
  `${group.filter((item) => jev(item) === item.deepseek).length}/${group.length}`;
const byType = Object.entries(
  Object.groupBy(results, (item) =>
    item.q.question_id.endsWith("_abs") ? "abstention" : item.q.question_type
  )
);
const count = (
  setup: Item["setup"],
  pick: (item: (typeof results)[number]) => boolean
) => results.filter((item) => item.setup === setup && pick(item)).length;
const oneLine = (text: string, max: number) =>
  text.replaceAll(/\s+/gu, " ").replaceAll("|", "\\|").trim().slice(0, max);

const markdown = `# Jev as judge, run \`${RUN}\`

${results.length} answers already graded by DeepSeek (\`deepseek-flash\` with LongMemEval's prompts), graded again by Jev (\`${[...new Set(results.map((item) => item.model))].join(", ")}\`), correct when its score is at least ${THRESHOLD}. Regenerate with \`node eval/longmemeval/jev-judge.ts --run ${RUN}\`.

Agreement: **${agree.length}/${results.length}**.

| Setup | DeepSeek correct | Jev correct |
| --- | --- | --- |
| memsys | ${count("memsys", (item) => item.deepseek)} | ${count("memsys", jev)} |
| full context | ${count("full context", (item) => item.deepseek)} | ${count("full context", jev)} |

| Type | Agreement |
| --- | --- |
${byType.map(([type, list = []]) => `| ${type} | ${rate(list)} |`).join("\n")}

## Disagreements

| Question | Type | Setup | DeepSeek | Jev score | Expected | Response (end) |
| --- | --- | --- | --- | --- | --- | --- |
${results
  .filter((item) => jev(item) !== item.deepseek)
  .map(
    (item) =>
      `| ${item.q.question_id} | ${item.q.question_type} | ${item.setup} | ${item.deepseek ? "right" : "wrong"} | ${item.score.toFixed(2)} | ${oneLine(item.q.answer, 80)} | ${oneLine(item.response.slice(-240), 240)} |`
  )
  .join("\n")}
`;
await writeFile(
  path.join(RUN_DIR, "jev-judge.json"),
  JSON.stringify(
    results.map(({ deepseek, model, q, score, setup }) => ({
      deepseek,
      model,
      questionId: q.question_id,
      score,
      setup,
    })),
    null,
    2
  )
);
await writeFile(path.join(RUN_DIR, "jev-judge.md"), markdown);
process.stdout.write(`${markdown}\n`);
