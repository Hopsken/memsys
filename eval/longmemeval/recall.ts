// Recall phase (RFC 0003): Pi gets each question of a corpus in a fresh
// conversation with only list_tags and recall, and a budget of recall
// rounds. Every recall call is recorded and scored against the corpus's
// evidence labels; the answer is graded as a secondary metric.
//
//   node eval/longmemeval/recall.ts --corpus <name> --run <name> [--set smoke]
//
// Every conversation is appended to hub/runs/<run>/recalls.jsonl as it ends;
// results.json and results.md are written at the end. A conversation already
// in recalls.jsonl is not run again, so an interrupted run continues; delete
// results.json to score again.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import {
  corpusRecord,
  HARNESS,
  labels,
  loadCorpus,
  RUNS_DIR,
} from "./corpus.ts";
import { SETS } from "./dataset.ts";
import { answerCriteria, jev } from "./jev.ts";
import { piRun, runPi } from "./pi.ts";
import { report, score, scoreRun } from "./score.ts";
import type { Score } from "./score.ts";
import {
  currentMemories,
  exportLog,
  importLog,
  pool,
  readJson,
  readLines,
  SERVER,
  serverInstructions,
  setSettings,
} from "./server.ts";
import type { SettingsPatch } from "./server.ts";

const { values: args } = parseArgs({
  options: {
    concurrency: { default: "6", type: "string" },
    corpus: { type: "string" },
    model: { default: "opencode-go/deepseek-v4.1-flash", type: "string" },
    only: { type: "string" },
    repeats: { default: "3", type: "string" },
    rounds: { default: "5", type: "string" },
    run: { type: "string" },
    // Run only this set's questions of the corpus.
    set: { type: "string" },
    // JSON over the default settings, e.g. '{"relevanceFilter":"low"}'.
    settings: { default: "{}", type: "string" },
    thinking: { default: "low", type: "string" },
  },
});
const { corpus: CORPUS, run: RUN } = args;
if (CORPUS === undefined || RUN === undefined) {
  throw new Error("Name the corpus and the run: --corpus <name> --run <name>");
}
const RUN_DIR = path.join(RUNS_DIR, RUN);
const REPEATS = Number(args.repeats);
const SETTINGS: SettingsPatch = z
  .record(z.string(), z.json())
  .parse(JSON.parse(args.settings));
// Settings live in the memory space, so each setting gets its own spaces:
// runs with different settings can run side by side.
const settingsKey =
  Object.keys(SETTINGS).length === 0
    ? ""
    : `s${createHash("sha256").update(JSON.stringify(SETTINGS)).digest("hex").slice(0, 8)}-`;
const ROUNDS = Number(args.rounds);

const { dir: CORPUS_DIR, questions: all } = await loadCorpus(
  CORPUS,
  args.set === undefined ? undefined : z.enum(SETS).parse(args.set)
);
const only = args.only?.split(",");
const questions = all.filter((q) => !only || only.includes(q.id));
const LABELS = path.join(CORPUS_DIR, "labels.json");
if (!existsSync(LABELS)) {
  throw new Error(`${CORPUS} has no labels.json; run label.ts first`);
}
const corpusLabels = await readJson(LABELS, labels);
const instructions = await serverInstructions();
await mkdir(RUN_DIR, { recursive: true });
await writeFile(
  path.join(RUN_DIR, "run.json"),
  JSON.stringify(
    {
      corpus: CORPUS,
      model: args.model,
      recallRounds: ROUNDS,
      repeats: REPEATS,
      set: args.set ?? null,
      settings: SETTINGS,
      thinking: args.thinking,
    },
    null,
    2
  )
);

// One memory space per corpus and question, filled from memory.ndjson the
// first time any run needs it. The import keeps the redated timestamps, and
// a space that has the records already skips them.
const corpusSize: Record<string, number> = {};
const prepare = async (id: string) => {
  const records = await readLines(
    path.join(CORPUS_DIR, id, "memory.ndjson"),
    corpusRecord
  );
  corpusSize[id] = currentMemories(records).size;
  const space = `c-${CORPUS}-${settingsKey}${id}`;
  await setSettings(space, SETTINGS);
  const existing = await exportLog(space);
  if (existing.length !== records.length) {
    await importLog(space, records);
    const imported = await exportLog(space);
    if (imported.length !== records.length) {
      throw new Error(
        `${id}: imported ${imported.length} of ${records.length} records`
      );
    }
  }
  return space;
};

// One line per conversation, in the order they finished.
const RECALLS = path.join(RUN_DIR, "recalls.jsonl");
const conversation = piRun.extend({ id: z.string(), repeat: z.number() });
const conversations = await readLines(RECALLS, conversation);
const ran = new Set(conversations.map((c) => `${c.id}/${c.repeat}`));

await pool(questions, Number(args.concurrency), async (q) => {
  try {
    const space = await prepare(q.id);
    for (let k = 1; k <= REPEATS; k += 1) {
      if (ran.has(`${q.id}/${k}`)) {
        continue;
      }
      // Repeats of one question run one after another on purpose.
      // oxlint-disable-next-line no-await-in-loop
      const run = await runPi({
        dir: path.join(RUN_DIR, ".pi", q.id),
        mcpUrl: `${SERVER}/__dev/eval/${space}/mcp`,
        model: args.model,
        prompt: q.question,
        recallBudget: ROUNDS,
        stdin: "",
        system: `${HARNESS}\n\n${instructions}\n\nToday's date: ${q.date}.`,
        thinking: args.thinking,
      });
      const line = { id: q.id, repeat: k, ...run };
      // oxlint-disable-next-line no-await-in-loop
      await appendFile(RECALLS, `${JSON.stringify(line)}\n`);
      conversations.push(line);
    }
    process.stderr.write(`done ${q.id}\n`);
  } catch (error) {
    process.stderr.write(`failed ${q.id}: ${String(error)}\n`);
  }
});

// Score every conversation of the chosen questions. Conversations already in
// results.json keep their score; Jev grades the new answers in one pass.
const RESULTS = path.join(RUN_DIR, "results.json");
const scores: Score[] = existsSync(RESULTS)
  ? await readJson(RESULTS, z.array(score))
  : [];
const scored = new Set(scores.map((s) => `${s.id}/${s.repeat}`));
const unscored = questions.flatMap((q) =>
  conversations
    .filter((c) => c.id === q.id && !scored.has(`${c.id}/${c.repeat}`))
    .map((run) => ({ q, run }))
);

const judge = await jev();
try {
  await pool(unscored, 4, async ({ q, run }) => {
    const { scores: answer } = await judge.score(
      { correct: answerCriteria(q) },
      { answer: q.answer, question: q.question, response: run.answer }
    );
    scores.push(
      scoreRun(q, run, run.repeat, corpusLabels[q.id], answer["correct"] ?? 0)
    );
  });
} finally {
  await judge.dispose();
}
scores.sort((a, b) => a.id.localeCompare(b.id) || a.repeat - b.repeat);
await writeFile(RESULTS, JSON.stringify(scores, null, 2));
// Over every question with scores, so that --only does not shrink the report.
const markdown = report(all, scores, {
  corpus: CORPUS,
  corpusSize,
  model: args.model,
  recallRounds: ROUNDS,
  repeats: REPEATS,
  run: RUN,
  settings: SETTINGS,
  thinking: args.thinking,
});
await writeFile(path.join(RUN_DIR, "results.md"), markdown);
process.stdout.write(`${markdown}\n`);
