// LongMemEval_S (Wu et al., ICLR 2025), cleaned release: 500 questions, each
// with its own history of about 50 sessions under one "User". The dataset
// marks which sessions and turns hold the answer; that is the ground truth.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const FILE = path.join(
  import.meta.dirname,
  "data",
  "longmemeval_s_cleaned.json"
);
const URL =
  "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json";

const turn = z.object({
  content: z.string(),
  // Set only on turns of an evidence session that state the answer.
  has_answer: z.boolean().optional(),
  role: z.enum(["assistant", "user"]),
});
export type Turn = z.infer<typeof turn>;

const question = z.object({
  // Some answers are numbers in the file.
  answer: z.union([z.string(), z.number()]).transform(String),
  answer_session_ids: z.array(z.string()),
  haystack_dates: z.array(z.string()),
  haystack_session_ids: z.array(z.string()),
  haystack_sessions: z.array(z.array(turn)),
  question: z.string(),
  question_date: z.string(),
  // Abstention questions end in `_abs`.
  question_id: z.string(),
  question_type: z.string(),
});
export type Question = z.infer<typeof question>;

export const loadQuestions = async (): Promise<Question[]> => {
  if (!existsSync(FILE)) {
    process.stderr.write(`Downloading ${URL}\n`);
    const response = await fetch(URL);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, Buffer.from(await response.arrayBuffer()));
  }
  const text = await readFile(FILE, "utf-8");
  return z.array(question).parse(JSON.parse(text));
};

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export const sample = (questions: Question[], perType: number, seed = "") =>
  Object.values(Object.groupBy(questions, (q) => q.question_type))
    .flatMap((group = []) =>
      group
        .toSorted((a, b) =>
          hash(seed + a.question_id).localeCompare(hash(seed + b.question_id))
        )
        .slice(0, perType)
    )
    .toSorted((a, b) => a.question_id.localeCompare(b.question_id));

// Nested sets (RFC 0003). smoke is the head of dev's order, so a corpus
// written for dev serves smoke. holdout shares no question with dev and is
// drawn under its own seed, so it is never tuned on by accident.
export const SETS = ["smoke", "dev", "holdout", "full"] as const;
export type SetName = (typeof SETS)[number];

export const questionsOf = (all: Question[], set: SetName): Question[] => {
  switch (set) {
    case "smoke": {
      return sample(all, 2);
    }
    case "dev": {
      return sample(all, 10);
    }
    case "holdout": {
      const dev = new Set(sample(all, 10).map((q) => q.question_id));
      return sample(
        all.filter((q) => !dev.has(q.question_id)),
        10,
        "holdout"
      );
    }
    case "full": {
      return all.toSorted((a, b) => a.question_id.localeCompare(b.question_id));
    }
    default: {
      throw new Error(`Unknown set: ${String(set)}`);
    }
  }
};

const DATE =
  /^(?<y>\d{4})\/(?<m>\d{2})\/(?<d>\d{2}) \(\w+\) (?<hh>\d{2}):(?<mm>\d{2})$/u;

// "2023/05/20 (Sat) 02:21" → epoch ms, read as UTC.
export const parseDate = (value: string) => {
  const parts = DATE.exec(value)?.groups;
  if (!parts) {
    throw new Error(`Unexpected date: ${value}`);
  }
  const { d, hh, m, mm, y } = parts;
  return Date.parse(`${y}-${m}-${d}T${hh}:${mm}:00Z`);
};

export const transcript = (turns: Turn[]) =>
  turns
    .map(
      ({ content, role }) =>
        `${role === "user" ? "User" : "Assistant"}: ${content}`
    )
    .join("\n\n");

export const evidenceSession = z.object({
  date: z.string(),
  index: z.number(),
  sessionId: z.string(),
  turns: z.array(z.object({ content: z.string(), role: z.string() })),
});
export const slimQuestion = z.object({
  abstain: z.boolean(),
  answer: z.string(),
  date: z.string(),
  // In haystack order, which is the order the sessions happened in.
  evidence: z.array(evidenceSession),
  id: z.string(),
  question: z.string(),
  type: z.string(),
});
export type SlimQuestion = z.infer<typeof slimQuestion>;

export const slim = (q: Question): SlimQuestion => ({
  abstain: q.question_id.endsWith("_abs"),
  answer: q.answer,
  date: q.question_date,
  evidence: q.haystack_session_ids
    .map((sessionId, index) => ({ index, sessionId }))
    .filter(({ sessionId }) => q.answer_session_ids.includes(sessionId))
    .map(({ index, sessionId }) => ({
      date: q.haystack_dates[index] ?? "",
      index,
      sessionId,
      turns: (q.haystack_sessions[index] ?? [])
        .filter((t) => t.has_answer)
        .map(({ content, role }) => ({ content, role })),
    })),
  id: q.question_id,
  question: q.question,
  type: q.question_type,
});
