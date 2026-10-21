// LongMemEval_S (Wu et al., ICLR 2025), cleaned release: 500 questions, each
// with its own history of about 50 sessions, as one simulated user.

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

const hash = (id: string) => createHash("sha256").update(id).digest("hex");

// The same questions on every machine: per type, the ids with the smallest
// hashes. Abstention questions are sampled with their type.
export const sample = (questions: Question[], perType: number) =>
  Object.values(Object.groupBy(questions, (q) => q.question_type))
    .flatMap((group = []) =>
      group
        .toSorted((a, b) =>
          hash(a.question_id).localeCompare(hash(b.question_id))
        )
        .slice(0, perType)
    )
    .toSorted((a, b) => a.question_id.localeCompare(b.question_id));

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
