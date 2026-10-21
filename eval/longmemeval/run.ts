// LongMemEval through a real agent: Pi, connected to memsys over MCP, reads
// each past session and decides what to remember, then answers the question
// in a fresh conversation, recalling as it sees fit. See README.md.
//
//   node eval/longmemeval/run.ts --run pilot --per-type 1
//
// Every step writes its output under runs/<run>/<question>/ and is skipped
// when that output exists, so an interrupted run continues where it stopped.

import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { loadQuestions, parseDate, sample, transcript } from "./dataset.ts";
import type { Question } from "./dataset.ts";
import {
  checkPrompt,
  deepseek,
  evidencePrompt,
  evidenceRefs,
} from "./judge.ts";
import { piRun, runPi } from "./pi.ts";
import type { PiRun } from "./pi.ts";
import { recallArgs, report, verdict } from "./report.ts";
import type { Verdict } from "./report.ts";

const { values: args } = parseArgs({
  options: {
    concurrency: { default: "6", type: "string" },
    only: { type: "string" },
    "per-type": { default: "10", type: "string" },
    run: { type: "string" },
  },
});
const RUN = args.run;
if (RUN === undefined) {
  throw new Error("Name the run: --run <name>");
}

const RUN_DIR = path.join(import.meta.dirname, "runs", RUN);
const SERVER = process.env["MEMSYS_URL"] ?? "http://127.0.0.1:5174";
// DeepSeek serves only the alias; the version behind it can change, so each
// verdict records the fingerprint it was graded under.
const MODEL = process.env["MODEL"] ?? "deepseek/deepseek-flash";
const THINKING = process.env["THINKING"] ?? "medium";
const JUDGE = MODEL.replace(/^deepseek\//u, "");

const HARNESS =
  "You are the user's personal assistant across many separate conversations. Nothing carries over between conversations except what is in memsys, your long-term memory.";

const sessionLog = piRun.extend({
  date: z.string(),
  end: z.number(),
  index: z.number(),
  sessionId: z.string(),
  start: z.number(),
});
type SessionLog = z.infer<typeof sessionLog>;

// A record as /export writes it; other fields pass through to /import.
const logRecord = z.looseObject({
  at: z.string(),
  fragment: z.string().nullable(),
  ref: z.string(),
});
type LogRecord = z.infer<typeof logRecord>;

const readLines = async <T>(
  file: string,
  schema: z.ZodType<T>
): Promise<T[]> => {
  if (!existsSync(file)) {
    return [];
  }
  const text = await readFile(file, "utf-8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => schema.parse(JSON.parse(line)));
};

const readJson = async <T>(file: string, schema: z.ZodType<T>): Promise<T> =>
  schema.parse(JSON.parse(await readFile(file, "utf-8")));

const server = async (route: string, init?: RequestInit) => {
  const response = await fetch(`${SERVER}/__dev/eval/${route}`, init);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${route}: ${response.status} ${body}`);
  }
  return body;
};

const initialized = z.object({
  result: z.object({ instructions: z.string() }),
});

// Pi shows MCP server instructions only as one line, and not at all for tools
// it declares directly. Claude Code puts them in the system prompt, so the
// harness does the same, read live so edits to worker/mcp.ts take effect.
const serverInstructions = async () => {
  const body = await server("instructions/mcp", {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "longmemeval", version: "0" },
        protocolVersion: "2025-06-18",
      },
    }),
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  // The reply may come as one SSE event.
  const json = body.startsWith("{") ? body : (body.split("data: ")[1] ?? "");
  return initialized.parse(JSON.parse(json)).result.instructions;
};

const pi = (space: string, system: string, prompt: string, stdin = "") =>
  runPi({
    dir: path.join(RUN_DIR, ".pi", space),
    mcpUrl: `${SERVER}/__dev/eval/${space}/mcp`,
    model: MODEL,
    prompt,
    stdin,
    system,
    thinking: THINKING,
  });

// Step 1. Pi reads each session, oldest first, each in its own conversation,
// into the question's write space.
const writeSessions = async (
  q: Question,
  instructions: string,
  dir: string
) => {
  const file = path.join(dir, "sessions.jsonl");
  const logged = await readLines(file, sessionLog);
  const done = new Set(logged.map((s) => s.index));
  const order = q.haystack_dates
    .map((date, index) => ({ at: parseDate(date), index }))
    .toSorted((a, b) => a.at - b.at || a.index - b.index);
  for (const { index } of order) {
    if (done.has(index)) {
      continue;
    }
    const date = q.haystack_dates[index] ?? "";
    const start = Date.now();
    // Sessions are read in order: each may recall or revise earlier memories.
    // oxlint-disable-next-line no-await-in-loop
    const run = await pi(
      `${RUN}-${q.question_id}-w`,
      `${HARNESS}\n\n${instructions}`,
      `The conversation above between you and the user took place on ${date}. It has ended.`,
      transcript(q.haystack_sessions[index] ?? [])
    );
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

// Step 2. The write space holds real timestamps. Each record moves to its
// session's date, keeping its order, and the log is imported into a fresh
// question space, so recall shows when each memory was made.
const redate = async (q: Question, dir: string) => {
  const file = path.join(dir, "memory.ndjson");
  if (existsSync(file)) {
    return;
  }
  const sessions = await readLines(
    path.join(dir, "sessions.jsonl"),
    sessionLog
  );
  sessions.sort((a, b) => a.start - b.start);
  const exported = await server(`${RUN}-${q.question_id}-w/export`);
  const records = exported
    .split("\n")
    .filter(Boolean)
    .map((line) => logRecord.parse(JSON.parse(line)))
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let last = 0;
  const redated = records.map((record) => {
    const real = Date.parse(record.at);
    const session = sessions.findLast((s) => s.start <= real) ?? sessions[0];
    if (!session) {
      throw new Error(`${q.question_id}: records but no sessions`);
    }
    last = Math.max(parseDate(session.date) + (real - session.start), last + 1);
    return {
      ...record,
      at: new Date(last).toISOString(),
      session: session.index,
    };
  });
  // Import takes whole refs, and the dev server limits bodies to 32 KB.
  const chunks = [""];
  for (const group of Object.values(Object.groupBy(redated, (r) => r.ref))) {
    const lines = (group ?? [])
      .map(({ session: _, ...record }) => `${JSON.stringify(record)}\n`)
      .join("");
    if ((chunks.at(-1) ?? "").length + lines.length > 24_000) {
      chunks.push("");
    }
    chunks[chunks.length - 1] += lines;
  }
  for (const body of chunks.filter(Boolean)) {
    // Chunks go in order.
    // oxlint-disable-next-line no-await-in-loop
    await server(`${RUN}-${q.question_id}-q/import`, { body, method: "POST" });
  }
  await writeFile(file, redated.map((r) => JSON.stringify(r)).join("\n"));
};

// Step 3. A new conversation on the question's date, in the question space.
const ask = async (q: Question, instructions: string, dir: string) => {
  const file = path.join(dir, "answer.json");
  if (existsSync(file)) {
    return;
  }
  const run = await pi(
    `${RUN}-${q.question_id}-q`,
    `${HARNESS}\n\n${instructions}\n\nToday's date: ${q.question_date}.`,
    q.question
  );
  await writeFile(file, JSON.stringify(run, null, 2));
};

const currentMemories = (records: LogRecord[]) => {
  const memories = new Map<string, string>();
  for (const { fragment, ref } of records) {
    if (fragment === null) {
      memories.delete(ref);
    } else {
      memories.set(ref, fragment);
    }
  }
  return memories;
};

const recallResult = z.object({
  fragments: z.array(z.looseObject({ ref: z.string() })),
});

const returnedRefs = (answer: PiRun) =>
  new Set(
    answer.tools
      .filter((tool) => tool.name === "recall" && !tool.isError)
      .flatMap((tool) => recallResult.parse(JSON.parse(tool.result)).fragments)
      .map((fragment) => fragment.ref)
  );

// Step 4. Score the answer and label what memory held.
const judge = async (q: Question, dir: string) => {
  const file = path.join(dir, "verdict.json");
  if (existsSync(file)) {
    return;
  }
  const answer = await readJson(path.join(dir, "answer.json"), piRun);
  const sessions = await readLines(
    path.join(dir, "sessions.jsonl"),
    sessionLog
  );
  const memories = currentMemories(
    await readLines(path.join(dir, "memory.ndjson"), logRecord)
  );
  const check = await deepseek(JUDGE, checkPrompt(q, answer.answer));
  const abstain = q.question_id.endsWith("_abs");
  const labeled = abstain
    ? null
    : await deepseek(JUDGE, evidencePrompt(q, memories), true);
  const labels = labeled ? evidenceRefs(labeled.text) : [];
  const evidence = labels.filter((ref) => memories.has(ref));
  const returned = returnedRefs(answer);
  const result: Verdict = {
    abstain,
    answer: answer.answer,
    correct: check.text.toLowerCase().includes("yes"),
    cost: sessions.reduce((sum, s) => sum + s.cost, 0) + answer.cost,
    cues: answer.tools
      .filter((tool) => tool.name === "recall")
      .map((tool) => recallArgs.parse(tool.args)),
    evidence,
    evidenceReturned: evidence.filter((ref) => returned.has(ref)),
    expected: q.answer,
    fingerprint: check.fingerprint,
    memories: memories.size,
    piErrors: sessions.filter((s) => s.error).length + (answer.error ? 1 : 0),
    question: q.question,
    questionId: q.question_id,
    type: q.question_type,
    writes: sessions.reduce(
      (sum, s) => sum + s.tools.filter((t) => t.name !== "recall").length,
      0
    ),
  };
  await writeFile(file, JSON.stringify(result, null, 2));
};

const pool = async <T>(
  items: T[],
  size: number,
  task: (item: T) => Promise<void>
) => {
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      // Each worker takes one item at a time.
      // oxlint-disable-next-line no-await-in-loop
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
};

const all = await loadQuestions();
const only = args.only?.split(",");
const questions = only
  ? all.filter((q) => only.includes(q.question_id))
  : sample(all, Number(args["per-type"]));
const instructions = await serverInstructions();
await mkdir(RUN_DIR, { recursive: true });
await writeFile(path.join(RUN_DIR, "instructions.txt"), instructions);

await pool(questions, Number(args.concurrency), async (q) => {
  const dir = path.join(RUN_DIR, q.question_id);
  await mkdir(dir, { recursive: true });
  try {
    await writeSessions(q, instructions, dir);
    await redate(q, dir);
    await ask(q, instructions, dir);
    await judge(q, dir);
    process.stderr.write(`done ${q.question_id}\n`);
  } catch (error) {
    process.stderr.write(`failed ${q.question_id}: ${String(error)}\n`);
  }
});

const verdicts = await Promise.all(
  questions
    .map((q) => path.join(RUN_DIR, q.question_id, "verdict.json"))
    .filter((file) => existsSync(file))
    .map((file) => readJson(file, verdict))
);
const markdown = report(verdicts, {
  model: MODEL,
  run: RUN,
  thinking: THINKING,
});
await writeFile(path.join(RUN_DIR, "results.md"), markdown);
process.stdout.write(`${markdown}\n`);
