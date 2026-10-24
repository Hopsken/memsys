import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { corpusEntry, HARNESS, HUB, SETS_DIR } from "./corpus.ts";
import type { CorpusEntry } from "./corpus.ts";
import {
  loadQuestions,
  parseDate,
  questionsOf,
  SETS,
  slim,
  transcript,
} from "./dataset.ts";
import type { Question } from "./dataset.ts";
import { piRun, runPi } from "./pi.ts";
import {
  exportLog,
  pool,
  readJson,
  readLines,
  SERVER,
  serverInstructions,
  toolDescriptions,
} from "./server.ts";

const WRITE_TOOLS = ["remember", "revise", "forget"] as const;
const WRITER_VERSION = 1;
const WRITE_SOURCES = ["write.ts", "pi.ts", "dataset.ts"];

const sessionLog = piRun.extend({
  date: z.string(),
  end: z.number(),
  index: z.number(),
  sessionId: z.string(),
  start: z.number(),
});
type SessionLog = z.infer<typeof sessionLog>;

const sha = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);

const writeSessions = async (
  q: Question,
  options: { instructions: string; model: string; thinking: string },
  dir: string,
  space: string
) => {
  const file = path.join(dir, "sessions.jsonl");
  const logged = await readLines(file, sessionLog);
  const done = new Set(logged.map((s) => s.index));
  for (const [index, turns] of q.haystack_sessions.entries()) {
    if (done.has(index)) {
      continue;
    }
    const date = q.haystack_dates[index] ?? "";
    const start = Date.now();
    // oxlint-disable-next-line no-await-in-loop
    const run = await runPi({
      dir: path.join(dir, ".pi"),
      mcpUrl: `${SERVER}/__dev/eval/${space}/mcp`,
      model: options.model,
      prompt: `The conversation above between you and the user took place on ${date}. It has ended.`,
      stdin: transcript(turns),
      system: `${HARNESS}\n\n${options.instructions}`,
      thinking: options.thinking,
    });
    const log: SessionLog = {
      ...run,
      date,
      end: Date.now(),
      index,
      sessionId: q.haystack_session_ids[index] ?? "",
      start,
    };
    // oxlint-disable-next-line no-await-in-loop
    await appendFile(file, `${JSON.stringify(log)}\n`);
  }
};

const DAY = 86_400_000;

const redate = async (q: Question, dir: string, space: string) => {
  const file = path.join(dir, "memory.ndjson");
  if (existsSync(file)) {
    return;
  }
  const logged = await readLines(path.join(dir, "sessions.jsonl"), sessionLog);
  const sessions = logged.toSorted((a, b) => a.start - b.start);
  const days = Map.groupBy(
    sessions,
    (s) => parseDate(s.date) - (parseDate(s.date) % DAY)
  );
  const slotOf = new Map(
    [...days].flatMap(([day, group]) =>
      group
        .toSorted((a, b) => a.index - b.index)
        .map(
          (s, k) =>
            [
              s.index,
              {
                at: day + (k * DAY) / group.length,
                length: DAY / group.length,
              },
            ] as const
        )
    )
  );
  const exported = await exportLog(space);
  const records = exported.toSorted(
    (a, b) => Date.parse(a.at) - Date.parse(b.at)
  );
  let last = 0;
  const redated = records.map((record) => {
    const real = Date.parse(record.at);
    const session = sessions.findLast((s) => s.start <= real) ?? sessions[0];
    const slot = session && slotOf.get(session.index);
    if (!session || !slot) {
      throw new Error(`${q.question_id}: records but no sessions`);
    }
    const offset = Math.min(real - session.start, slot.length - 1000);
    last = Math.max(slot.at + offset, last + 1);
    return {
      ...record,
      at: new Date(last).toISOString(),
      session: session.index,
    };
  });
  await writeFile(file, redated.map((r) => JSON.stringify(r)).join("\n"));
};

const { values: args } = parseArgs({
  options: {
    concurrency: { default: "6", type: "string" },
    model: { default: "opencode-go/deepseek-v4.1-flash", type: "string" },
    only: { type: "string" },
    set: { default: "dev", type: "string" },
    subset: { type: "string" },
    thinking: { default: "high", type: "string" },
  },
});
const set = z.enum(SETS).parse(args.set);
const MODEL = args.model;
const THINKING = args.thinking;

const all = await loadQuestions();
await mkdir(SETS_DIR, { recursive: true });
for (const name of SETS) {
  // oxlint-disable-next-line no-await-in-loop
  await writeFile(
    path.join(SETS_DIR, `${name}.json`),
    JSON.stringify(questionsOf(all, name).map(slim), null, 2)
  );
}
const only = args.only?.split(",");
const subset = args.subset
  ? new Set(
      questionsOf(all, z.enum(SETS).parse(args.subset)).map(
        (q) => q.question_id
      )
    )
  : null;
const questions = questionsOf(all, set).filter(
  (q) =>
    (!only || only.includes(q.question_id)) &&
    (subset?.has(q.question_id) ?? true)
);

const instructions = await serverInstructions();
const descriptions = await toolDescriptions();
const tools = Object.fromEntries(
  WRITE_TOOLS.map((tool) => [tool, descriptions[tool] ?? ""])
);
const sources = await Promise.all(
  WRITE_SOURCES.map((file) =>
    readFile(path.join(import.meta.dirname, file), "utf-8")
  )
);
const harness = sha(sources.join("\n"));
const version = {
  commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: import.meta.dirname,
    encoding: "utf-8",
  }).trim(),
  harness,
  instructions: sha(instructions),
  tools: Object.fromEntries(
    Object.entries(tools).map(([name, text]) => [name, sha(text)])
  ),
};
const key = sha(
  JSON.stringify({
    instructions: version.instructions,
    model: MODEL,
    set,
    thinking: THINKING,
    tools: version.tools,
    writer: WRITER_VERSION,
  })
).slice(0, 8);
const NAME = `${set}-${MODEL.split("/").at(-1) ?? MODEL}-${key}`;
const DIR = path.join(HUB, NAME);
await mkdir(DIR, { recursive: true });
await writeFile(path.join(DIR, "instructions.txt"), instructions);
await writeFile(path.join(DIR, "tools.json"), JSON.stringify(tools, null, 2));
process.stderr.write(`corpus ${NAME}: ${questions.length} questions\n`);

await pool(questions, Number(args.concurrency), async (q) => {
  const dir = path.join(DIR, q.question_id);
  const space = `w-${NAME}-${q.question_id}`;
  await mkdir(dir, { recursive: true });
  try {
    await writeSessions(
      q,
      { instructions, model: MODEL, thinking: THINKING },
      dir,
      space
    );
    await redate(q, dir, space);
    process.stderr.write(`done ${q.question_id}\n`);
  } catch (error) {
    process.stderr.write(`failed ${q.question_id}: ${String(error)}\n`);
  }
});

const written = questionsOf(all, set).filter((q) =>
  existsSync(path.join(DIR, q.question_id, "memory.ndjson"))
);
let cost = 0;
let records = 0;
for (const q of written) {
  const dir = path.join(DIR, q.question_id);
  // oxlint-disable-next-line no-await-in-loop
  const sessions = await readLines(
    path.join(dir, "sessions.jsonl"),
    sessionLog
  );
  cost += sessions.reduce((sum, s) => sum + s.cost, 0);
  // oxlint-disable-next-line no-await-in-loop
  const text = await readFile(path.join(dir, "memory.ndjson"), "utf-8");
  records += text.split("\n").filter(Boolean).length;
}
const META = path.join(DIR, "corpus.json");
const previous = existsSync(META)
  ? await readJson(META, corpusEntry)
  : undefined;
const entry: CorpusEntry = {
  cost,
  key,
  model: MODEL,
  questions: written.length,
  records,
  set,
  thinking: THINKING,
  version,
  writtenAt: previous?.writtenAt ?? new Date().toISOString(),
};
await writeFile(META, `${JSON.stringify(entry, null, 2)}\n`);
process.stdout.write(
  `${NAME}: ${written.length}/${questionsOf(all, set).length} questions, ${records} records, $${cost.toFixed(2)}\n`
);
