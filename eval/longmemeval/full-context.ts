// The control for a memsys run: the same model answers each question with
// the whole history in its prompt and no memory at all. If this scores as
// well as memsys, memory adds nothing on these questions.
//
//   node eval/longmemeval/full-context.ts --run baseline-1021
//
// Takes the questions of an existing run, writes full-context.json next to
// each verdict, and full-context.md in the run directory.

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { loadQuestions, parseDate } from "./dataset.ts";
import type { Question } from "./dataset.ts";
import { checkPrompt, deepseek } from "./judge.ts";
import { verdict } from "./report.ts";

const { values: args } = parseArgs({
  options: {
    concurrency: { default: "6", type: "string" },
    run: { type: "string" },
  },
});
const RUN = args.run;
if (RUN === undefined) {
  throw new Error("Name the run whose questions to answer: --run <name>");
}
const RUN_DIR = path.join(import.meta.dirname, "runs", RUN);
const MODEL = (process.env["MODEL"] ?? "deepseek/deepseek-flash").replace(
  /^deepseek\//u,
  ""
);
// DeepSeek list prices per million tokens, as Pi's catalog has them.
const PRICE = { cacheHit: 0.006, input: 0.3, output: 1.2 };

// LongMemEval's full-context prompt with chain of thought
// (src/generation/run_generation.py: orig-session, nl history, cot).
const prompt = (q: Question) => {
  const sessions = q.haystack_sessions
    .map((turns, index) => ({ date: q.haystack_dates[index] ?? "", turns }))
    .toSorted((a, b) => parseDate(a.date) - parseDate(b.date));
  const history = sessions
    .map(
      ({ date, turns }, index) =>
        `\n### Session ${index + 1}:\nSession Date: ${date}\nSession Content:\n${turns
          .map(({ content, role }) => `\n\n${role}: ${content.trim()}`)
          .join("")}\n`
    )
    .join("");
  return `I will give you several history chats between you and a user. Please answer the question based on the relevant chat history. Answer the question step by step: first extract all the relevant information, and then reason over the information to get the answer.\n\n\nHistory Chats:\n\n${history}\n\nCurrent Date: ${q.question_date}\nQuestion: ${q.question}\nAnswer (step by step):`;
};

const completion = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
  usage: z.object({
    completion_tokens: z.number(),
    prompt_cache_hit_tokens: z.number().default(0),
    prompt_tokens: z.number(),
  }),
});

const answer = async (q: Question) => {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    body: JSON.stringify({
      messages: [{ content: prompt(q), role: "user" }],
      model: MODEL,
      // Pi ran with thinking on; so does the control.
      thinking: { type: "enabled" },
    }),
    headers: {
      Authorization: `Bearer ${process.env["DEEPSEEK_API_KEY"] ?? ""}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`DeepSeek: ${response.status} ${await response.text()}`);
  }
  const body = completion.parse(await response.json());
  const { completion_tokens, prompt_cache_hit_tokens, prompt_tokens } =
    body.usage;
  const cost =
    ((prompt_tokens - prompt_cache_hit_tokens) * PRICE.input +
      prompt_cache_hit_tokens * PRICE.cacheHit +
      completion_tokens * PRICE.output) /
    1e6;
  return {
    answer: body.choices[0]?.message.content ?? "",
    cost,
    promptTokens: prompt_tokens,
  };
};

const result = z.object({
  answer: z.string(),
  correct: z.boolean(),
  cost: z.number(),
  fingerprint: z.string(),
  promptTokens: z.number(),
});
type Result = z.infer<typeof result>;

const control = async (q: Question): Promise<Result> => {
  const file = path.join(RUN_DIR, q.question_id, "full-context.json");
  if (existsSync(file)) {
    return result.parse(JSON.parse(await readFile(file, "utf-8")));
  }
  const answered = await answer(q);
  const check = await deepseek(MODEL, checkPrompt(q, answered.answer));
  const done: Result = {
    ...answered,
    correct: check.text.toLowerCase().includes("yes"),
    fingerprint: check.fingerprint,
  };
  await writeFile(file, JSON.stringify(done, null, 2));
  return done;
};

const ids = new Set(await readdir(RUN_DIR));
const all = await loadQuestions();
const questions = all.filter(
  (q) =>
    ids.has(q.question_id) &&
    existsSync(path.join(RUN_DIR, q.question_id, "verdict.json"))
);

const rows: { memsys: boolean; q: Question; full: Result }[] = [];
const queue = [...questions];
const worker = async () => {
  for (let q = queue.shift(); q !== undefined; q = queue.shift()) {
    try {
      // Each worker takes one question at a time.
      // oxlint-disable-next-line no-await-in-loop
      const full = await control(q);
      // oxlint-disable-next-line no-await-in-loop
      const text = await readFile(
        path.join(RUN_DIR, q.question_id, "verdict.json"),
        "utf-8"
      );
      rows.push({ full, memsys: verdict.parse(JSON.parse(text)).correct, q });
      process.stderr.write(`done ${q.question_id}\n`);
    } catch (error) {
      process.stderr.write(`failed ${q.question_id}: ${String(error)}\n`);
    }
  }
};
await Promise.all(Array.from({ length: Number(args.concurrency) }, worker));

rows.sort((a, b) => a.q.question_id.localeCompare(b.q.question_id));
const score = (
  items: typeof rows,
  pick: (row: (typeof rows)[number]) => boolean
) => `${items.filter(pick).length}/${items.length}`;
const byType = Object.entries(
  Object.groupBy(rows, (row) => row.q.question_type)
);
const cost = rows.reduce((sum, row) => sum + row.full.cost, 0);
const tokens = rows.reduce((sum, row) => sum + row.full.promptTokens, 0);
const disagree = rows.filter((row) => row.memsys !== row.full.correct);
const markdown = `# Full context against memsys, run \`${RUN}\`

The same ${rows.length} questions, answered by \`${MODEL}\` with thinking on and every session in the prompt (LongMemEval's own full-context prompt), graded by the same judge. Average prompt ${Math.round(tokens / Math.max(rows.length, 1)).toLocaleString("en")} tokens; cost $${cost.toFixed(2)} at list prices. Regenerate with \`node eval/longmemeval/full-context.ts --run ${RUN}\`.

| Type | memsys + Pi | Full context |
| --- | --- | --- |
${byType
  .map(
    ([type, items = []]) =>
      `| ${type} | ${score(items, (row) => row.memsys)} | ${score(items, (row) => row.full.correct)} |`
  )
  .join("\n")}
| **all** | ${score(rows, (row) => row.memsys)} | ${score(rows, (row) => row.full.correct)} |

## Questions where they disagree

| Question | Type | memsys | Full context | Full-context answer |
| --- | --- | --- | --- | --- |
${disagree
  .map(
    ({ full, memsys, q }) =>
      `| ${q.question_id} | ${q.question_type} | ${memsys ? "right" : "wrong"} | ${full.correct ? "right" : "wrong"} | ${full.answer.replaceAll(/\s+/gu, " ").replaceAll("|", "\\|").slice(-200)} |`
  )
  .join("\n")}
`;
await writeFile(path.join(RUN_DIR, "full-context.md"), markdown);
process.stdout.write(`${markdown}\n`);
