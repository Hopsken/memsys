// The fragment log's NDJSON codec and replay. Pure: no Cloudflare imports, so
// the Durable Object, import, and any other tool read the log the same way.

import { z } from "zod";

import type { Author, Fragment, LogRecord, Op } from "../contract/memory";
import { fragment, logRecord } from "./memory";

// A record as stored: `at` in epoch milliseconds; a null fragment is forgotten.
export interface Row {
  at: number;
  by: Author | null;
  fragment: string | null;
  op: Op;
  ref: string;
}

// A current fragment written out on its own has no history to name an op.
type Snapshot = Omit<Row, "by" | "op"> & Partial<Pick<Row, "by" | "op">>;

// The op a record's place in its ref's log implies, for records that do not
// name one: the first is a remember, one after a forget a restore.
const impliedOp = (text: string | null, previous?: string | null): Op => {
  if (text === null) {
    return "forget";
  }
  if (previous === undefined) {
    return "remember";
  }
  return previous === null ? "restore" : "revise";
};

export interface Issue {
  message: string;
  path: string[];
}

// A file with more problems than this is not worth listing line by line.
const MAX_ISSUES = 20;

const lines = (content: string) => {
  const all = content.split("\n");
  // Every record ends with LF, so a complete file ends with an empty string.
  if (all.at(-1) === "") {
    all.pop();
  }
  return all;
};

const logLine = z
  .string()
  .transform((line, ctx) => {
    try {
      return JSON.parse(line);
    } catch {
      ctx.addIssue({ code: "custom", message: "Not a JSON record" });
      return z.NEVER;
    }
  })
  .pipe(logRecord);

export const parseLog = (
  content: string
): { rows: Row[] } | { issues: Issue[] } => {
  const parsed: z.output<typeof logRecord>[] = [];
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines(content).entries()) {
    if (issues.length >= MAX_ISSUES) {
      break;
    }
    const number = String(index + 1);
    const result = logLine.safeParse(line);
    if (!result.success) {
      issues.push(
        ...result.error.issues.map(({ message, path }) => ({
          message,
          path: [number, ...path.map(String)],
        }))
      );
      continue;
    }
    const { data: record } = result;
    const key = `${record.ref} ${record.at}`;
    if (seen.has(key)) {
      issues.push({
        message: `Ref ${record.ref} has two records at the same time`,
        path: [number, "at"],
      });
      continue;
    }
    seen.add(key);
    parsed.push(record);
  }
  if (issues.length > 0) {
    return { issues };
  }
  const last = new Map<string, string | null>();
  const rows = parsed
    .toSorted((a, b) => a.at - b.at)
    .map(({ at, by = null, fragment: text, op, ref }): Row => {
      const previous = last.has(ref) ? last.get(ref) : undefined;
      last.set(ref, text);
      return {
        at,
        by,
        fragment: text,
        op: op ?? impliedOp(text, previous),
        ref,
      };
    });
  return { rows };
};

// Plain text: every non-empty line is one new fragment.
export const parseText = (
  content: string
): { texts: string[] } | { issues: Issue[] } => {
  const texts: string[] = [];
  const issues: Issue[] = [];
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (issues.length >= MAX_ISSUES) {
      break;
    }
    if (line.trim() === "") {
      continue;
    }
    const parsed = fragment.safeParse(line);
    if (parsed.success) {
      texts.push(parsed.data);
    } else {
      issues.push(
        ...parsed.error.issues.map(({ message }) => ({
          message,
          path: [String(index + 1)],
        }))
      );
    }
  }
  return issues.length > 0 ? { issues } : { texts };
};

// Lines sorted by `at`, each ending with LF. An unknown author is left out.
export const serializeLog = (rows: Iterable<Snapshot>): string =>
  [...rows]
    .toSorted((a, b) => a.at - b.at || a.ref.localeCompare(b.ref))
    .map(({ at, by, fragment: text, op, ref }) => {
      // The format's key order, not alphabetical.
      // oxlint-disable-next-line sort-keys
      const record: LogRecord = {
        v: 1,
        ref,
        fragment: text,
        at: new Date(at).toISOString(),
        ...(op && { op }),
        ...(by && { by }),
      };
      return `${JSON.stringify(record)}\n`;
    })
    .join("");

// Per ref, the latest record wins, so rows may come in any order. `heads`
// holds every ref seen, forgotten ones included, with its latest `at`.
export const replay = (
  rows: Iterable<Pick<Row, "at" | "fragment" | "ref">>
) => {
  const corpus = new Map<string, Fragment>();
  const heads = new Map<string, number>();
  for (const { at, fragment: text, ref } of rows) {
    if (at <= (heads.get(ref) ?? Number.NEGATIVE_INFINITY)) {
      continue;
    }
    heads.set(ref, at);
    if (text === null) {
      corpus.delete(ref);
    } else {
      corpus.set(ref, { at: new Date(at).toISOString(), fragment: text, ref });
    }
  }
  return { corpus, heads };
};
