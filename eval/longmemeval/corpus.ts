// What the write, label, and recall phases share about a corpus: where it
// lives, what its corpus.json says, and the files inside it. No side effects
// on import, so every phase can import it.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { SETS, slimQuestion } from "./dataset.ts";
import type { SetName, SlimQuestion } from "./dataset.ts";
import { logRecord, readJson } from "./server.ts";

export const HARNESS =
  "You are the user's personal assistant across many separate conversations. Nothing carries over between conversations except what is in memsys, your long-term memory.";

// All test data lives in this Hugging Face dataset: the question sets with
// their answers, every corpus with its evidence labels, and kept runs. HUB is
// a local copy of its root, filled on demand; git holds only the harness.
export const REPO = "Hopsken/memsys-longmemeval-corpora";
export const HUB = path.join(import.meta.dirname, "hub");
export const SETS_DIR = path.join(HUB, "sets");
export const RUNS_DIR = path.join(HUB, "runs");

// Downloads the files matching these patterns (relative to the dataset
// root) that are not in HUB yet. Files already there are kept as they are,
// so local edits, such as hand-corrected labels, are never overwritten.
export const pull = (...patterns: string[]) => {
  execFileSync(
    "hf",
    [
      "download",
      REPO,
      "--repo-type",
      "dataset",
      ...patterns.flatMap((p) => ["--include", p]),
      "--local-dir",
      HUB,
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
};

// corpus.json in each corpus folder: what wrote it and what it cost.
export const corpusEntry = z.object({
  cost: z.number(),
  key: z.string(),
  model: z.string(),
  questions: z.number(),
  // Log records over all questions; the current fragments are fewer.
  records: z.number(),
  set: z.enum(SETS),
  thinking: z.string(),
  version: z.object({
    commit: z.string(),
    // Hash of the write-side harness files, for the record.
    harness: z.string(),
    instructions: z.string(),
    tools: z.record(z.string(), z.string()),
  }),
  writtenAt: z.string(),
});
export type CorpusEntry = z.infer<typeof corpusEntry>;

// A memory.ndjson record: the log record plus the session it was written in.
export const corpusRecord = logRecord.extend({ session: z.number() });
export type CorpusRecord = z.infer<typeof corpusRecord>;

// labels.json: question id → evidence session index → refs of the
// answer-bearing fragments. An empty list is a write miss.
export const labels = z.record(
  z.string(),
  z.record(z.string(), z.array(z.string()))
);
export type Labels = z.infer<typeof labels>;

// The evidence sessions recall has to bring back. Sessions the dataset marks
// without answer turns cannot be labeled and are left out. A knowledge-update
// question needs only its last evidence session, the current value; the
// earlier ones hold what it replaced, which score.ts reports as stale.
// Abstention questions require nothing: finding is not their point.
export const requiredSessions = (q: SlimQuestion): number[] => {
  if (q.abstain) {
    return [];
  }
  const labelable = q.evidence.filter((s) => s.turns.length > 0);
  const required =
    q.type === "knowledge-update" ? labelable.slice(-1) : labelable;
  return required.map((s) => s.index);
};

export const readSet = (set: SetName) => {
  const file = path.join(SETS_DIR, `${set}.json`);
  if (!existsSync(file)) {
    pull(`sets/${set}.json`);
  }
  return readJson(file, z.array(slimQuestion));
};

export const loadCorpus = async (name: string, subset?: SetName) => {
  const dir = path.join(HUB, name);
  const meta = path.join(dir, "corpus.json");
  if (!existsSync(meta)) {
    pull(`${name}/corpus.json`, `${name}/labels.json`);
  }
  if (!existsSync(meta)) {
    throw new Error(`${name} is not on ${REPO}`);
  }
  const entry = await readJson(meta, corpusEntry);
  const setQuestions = await readSet(entry.set);
  const written = (q: SlimQuestion) =>
    existsSync(path.join(dir, q.id, "memory.ndjson"));
  if (setQuestions.filter(written).length < entry.questions) {
    pull(`${name}/*/memory.ndjson`);
  }
  const subsetQuestions = subset ? await readSet(subset) : null;
  const inSubset = subsetQuestions && new Set(subsetQuestions.map((q) => q.id));
  const questions = setQuestions.filter(
    (q) => (inSubset?.has(q.id) ?? true) && written(q)
  );
  return { dir, entry, questions };
};
