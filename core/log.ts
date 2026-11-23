import { z } from "zod";

import type { Issue } from "@lib/result";

import {
  fragmentTextSchema,
  logRecordSchema,
  personaRecordSchema,
} from "./model";
import type {
  Fragment,
  LogRecord,
  Op,
  Persona,
  PersonaRecord,
  Source,
} from "./model";

export interface Row {
  createdAt: number;
  fragment: string | null;
  id: number;
  op: Op;
  ref: string;
  source: Source | null;
}

export type NewRecord = Omit<Row, "createdAt" | "id"> & {
  /** Omitted when the store should stamp the record's write time. */
  createdAt?: number;
};

type Snapshot = Omit<Row, "id" | "op" | "source"> &
  Partial<Pick<Row, "op" | "source">>;

/** One ref's projection, after replaying its records in ascending id order. */
export interface RefState {
  active: boolean;
  /** The first non-null record's time, kept across a forget. */
  createdAt: number;
  /** The latest record's time, null record included. */
  latestAt: number;
  /** The latest record's id, null record included. */
  latestId: number;
  text: {
    fragment: string;
    id: number;
    source: Source | null;
    updatedAt: number;
  } | null;
  versions: number;
}

const impliedOp = (text: string | null, previous?: string | null): Op => {
  if (text === null) {
    return "forget";
  }
  if (previous === undefined) {
    return "remember";
  }
  return previous === null ? "restore" : "revise";
};

const MAX_ISSUES = 20;

const lines = (content: string) => {
  const all = content.split("\n");
  if (all.at(-1) === "") {
    all.pop();
  }
  return all;
};

const jsonLineSchema = z.string().transform((line, ctx) => {
  try {
    return JSON.parse(line);
  } catch {
    ctx.addIssue({ code: "custom", message: "Not a JSON record" });
    return z.NEVER;
  }
});

const hasPersonaKeySchema = z.looseObject({ persona: z.string() });

const toPersona = ({
  archivedAt,
  createdAt,
  name,
  persona,
}: PersonaRecord): Persona => ({
  archivedAt: archivedAt ?? null,
  createdAt,
  id: persona,
  name,
});

/**
 * Reads a log whose lines are the causal order. Timestamps are only times, so
 * two records may share one, and a ref may appear, disappear, and come back.
 */
export const parseLog = (
  content: string
): { personas: Persona[]; rows: NewRecord[] } | { issues: Issue[] } => {
  const parsed: z.output<typeof logRecordSchema>[] = [];
  const personas = new Map<string, Persona>();
  const issues: Issue[] = [];
  for (const [index, line] of lines(content).entries()) {
    if (issues.length >= MAX_ISSUES) {
      break;
    }
    const number = String(index + 1);
    const json = jsonLineSchema.safeParse(line);
    const result = json.success
      ? (hasPersonaKeySchema.safeParse(json.data).success
          ? personaRecordSchema
          : logRecordSchema
        ).safeParse(json.data)
      : json;
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
    if ("persona" in record) {
      personas.set(record.persona, toPersona(record));
      continue;
    }
    parsed.push(record);
  }
  if (issues.length > 0) {
    return { issues };
  }
  const last = new Map<string, string | null>();
  const rows = parsed.map(
    ({ createdAt, fragment: text, op, ref, source = null }): NewRecord => {
      const previous = last.has(ref) ? last.get(ref) : undefined;
      last.set(ref, text);
      return {
        createdAt,
        fragment: text,
        op: op ?? impliedOp(text, previous),
        ref,
        source,
      };
    }
  );
  return { personas: [...personas.values()], rows };
};

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
    const parsed = fragmentTextSchema.safeParse(line);
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

const serializePersona = ({
  archivedAt,
  createdAt,
  id,
  name,
}: Persona): string => {
  // oxlint-disable-next-line sort-keys
  const record: PersonaRecord = {
    v: 1,
    persona: id,
    name,
    createdAt,
    ...(archivedAt !== null && { archivedAt }),
  };
  return `${JSON.stringify(record)}\n`;
};

/** Writes records in the order given; the caller owns the causal order. */
export const serializeLog = (
  personas: Persona[],
  rows: Iterable<Snapshot>
): string =>
  personas.map(serializePersona).join("") +
  [...rows]
    .map(({ createdAt, fragment: text, op, ref, source }) => {
      // oxlint-disable-next-line sort-keys
      const record: LogRecord = {
        v: 1,
        ref,
        fragment: text,
        createdAt: new Date(createdAt).toISOString(),
        ...(op && { op }),
        ...(source && { source }),
      };
      return `${JSON.stringify(record)}\n`;
    })
    .join("");

export const applyRecord = (
  previous: RefState | undefined,
  { createdAt, fragment, id, ref, source }: Row
): RefState => {
  if (previous !== undefined && id <= previous.latestId) {
    throw new Error(
      `[Log] records for ${ref} must replay in ascending id order (${id} <= ${previous.latestId})`
    );
  }
  const versions = (previous?.versions ?? 0) + 1;
  if (fragment === null) {
    return {
      active: false,
      createdAt: previous?.createdAt ?? createdAt,
      latestAt: createdAt,
      latestId: id,
      text: previous?.text ?? null,
      versions,
    };
  }
  return {
    active: true,
    createdAt:
      previous === undefined || previous.text === null
        ? createdAt
        : previous.createdAt,
    latestAt: createdAt,
    latestId: id,
    text: { fragment, id, source, updatedAt: createdAt },
    versions,
  };
};

export const toFragment = (ref: string, state: RefState): Fragment | null =>
  state.active && state.text
    ? {
        createdAt: new Date(state.createdAt).toISOString(),
        fragment: state.text.fragment,
        ref,
        source: state.text.source,
        updatedAt: new Date(state.text.updatedAt).toISOString(),
        versionId: state.text.id,
      }
    : null;

/** Replays records already in ascending id order. */
export const replay = (rows: Iterable<Row>) => {
  const refs = new Map<string, RefState>();
  for (const row of rows) {
    refs.set(row.ref, applyRecord(refs.get(row.ref), row));
  }
  const corpus = new Map<string, Fragment>();
  for (const [ref, state] of refs) {
    const item = toFragment(ref, state);
    if (item) {
      corpus.set(ref, item);
    }
  }
  return { corpus, refs };
};
