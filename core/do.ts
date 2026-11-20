import { DurableObject } from "cloudflare:workers";
import { and, asc, desc, eq, isNotNull, lt, max, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { customAlphabet } from "nanoid";
import { z } from "zod";

import { err, ok } from "@lib/result";
import type { Issue, Result } from "@lib/result";

import { metadata, personas, records } from "./db/schema";
import {
  activityInputSchema,
  importInputSchema,
  inputSchemas,
  listFragments,
  PAGE_SIZE,
  personaInputSchemas,
} from "./inputs";
import {
  applyRecord,
  parseLog,
  parseText,
  replay,
  serializeLog,
  toFragment,
} from "./log";
import type { ParsedRow, RefState, Row } from "./log";
import { mergePatch } from "./merge-patch";
import migrations from "./migrations/migrations.js";
import {
  LOG_CURSOR_KEY,
  PERSONA_ID_LENGTH,
  REF_ALPHABET,
  REF_LENGTH,
} from "./model";
import type { Fragment, Op, Persona, Source, Version } from "./model";
import type {
  ActivityPage,
  Diagnostics,
  ForgottenList,
  FragmentPage,
  History,
  ImportFormat,
  ImportResult,
  InvalidInput,
  LogRead,
  MemoryCore,
  Metadata,
  NotFound,
  Restored,
  SourceSummary,
} from "./types";

const newRef = customAlphabet(REF_ALPHABET, REF_LENGTH);
const newPersonaId = customAlphabet(REF_ALPHABET, PERSONA_ID_LENGTH);

const freshRef = (taken: { has: (ref: string) => boolean }) => {
  let ref = newRef();
  while (taken.has(ref)) {
    ref = newRef();
  }
  return ref;
};

const invalid = (error: z.ZodError): InvalidInput => ({
  code: "invalid",
  issues: error.issues.map(({ message, path }) => ({
    message,
    path: path.map(String),
  })),
  message: z.prettifyError(error),
  reason: "invalid-input",
});

const invalidFile = (issues: Issue[]): InvalidInput => ({
  code: "invalid",
  issues,
  message: issues
    .map(({ message, path: [line, ...field] }) =>
      [`Line ${line}`, ...field].join(", ").concat(`: ${message}`)
    )
    .join("\n"),
  reason: "invalid-input",
});

const notFound = (versionId?: number): { error: NotFound; ok: false } =>
  err(
    versionId === undefined
      ? {
          code: "not-found",
          message: "Fragment not found",
          reason: "fragment-not-found",
        }
      : {
          code: "not-found",
          message: "Version not found",
          reason: "version-not-found",
        }
  );

const personaNotFound = (): { error: NotFound; ok: false } =>
  err({
    code: "not-found",
    message: "Persona not found",
    reason: "persona-not-found",
  });

const toPersona = (row: typeof personas.$inferSelect): Persona => ({
  archivedAt:
    row.archivedAt === null ? null : new Date(row.archivedAt).toISOString(),
  createdAt: new Date(row.createdAt).toISOString(),
  id: row.id,
  name: row.name,
});

const toVersion = ({
  createdAt,
  fragment,
  id,
  op,
  ref,
  source,
}: Row): Version => ({
  createdAt: new Date(createdAt).toISOString(),
  fragment,
  id,
  op,
  ref,
  source,
});

// Cloudflare offers no API for where a Durable Object lives; a request from
// inside it reports the data center it runs in.
const currentColo = async () => {
  try {
    const response = await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
      signal: AbortSignal.timeout(3000),
    });
    const trace = await response.text();
    return /^colo=(?<colo>[A-Z]{3})$/mu.exec(trace)?.groups?.["colo"] ?? null;
  } catch {
    return null;
  }
};

export type CoreEnv = Record<never, never>;

export class MemoryDO extends DurableObject<CoreEnv> implements MemoryCore {
  private readonly db;
  private readonly corpus = new Map<string, Fragment>();
  private readonly refs = new Map<string, RefState>();
  private readonly versions = new Map<string, number>();
  private readonly metadata = new Map<string, Metadata>();
  private readonly personaById = new Map<string, Persona>();

  constructor(ctx: DurableObjectState, env: CoreEnv) {
    super(ctx, env);
    this.db = drizzle(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => {
      const result = await Promise.resolve(migrate(this.db, migrations));
      if (result !== undefined) {
        throw new Error(`[DB] migrations failed with code: ${result.exitCode}`);
      }
      this.load();
    });
  }

  private load() {
    const rows = this.db.select().from(records).orderBy(asc(records.id)).all();
    const { corpus, refs } = replay(rows);
    this.corpus.clear();
    for (const [ref, item] of corpus) {
      this.corpus.set(ref, item);
    }
    this.refs.clear();
    for (const [ref, state] of refs) {
      this.refs.set(ref, state);
    }
    this.versions.clear();
    this.countVersions(rows);
    this.metadata.clear();
    for (const { key, value } of this.db.select().from(metadata).all()) {
      this.metadata.set(key, value);
    }
    this.personaById.clear();
    const personaRows = this.db
      .select()
      .from(personas)
      .orderBy(sql`rowid`)
      .all();
    for (const row of personaRows) {
      this.personaById.set(row.id, toPersona(row));
    }
  }

  private freshPersonaId() {
    let id = newPersonaId();
    while (this.personaById.has(id)) {
      id = newPersonaId();
    }
    return id;
  }

  private addPersonas(imported: Persona[]) {
    for (const persona of imported) {
      if (this.personaById.has(persona.id)) {
        continue;
      }
      this.db
        .insert(personas)
        .values({
          archivedAt:
            persona.archivedAt === null ? null : Date.parse(persona.archivedAt),
          createdAt: Date.parse(persona.createdAt),
          id: persona.id,
          name: persona.name,
        })
        .run();
      this.personaById.set(persona.id, persona);
    }
  }

  private isKnownSource(source: Source) {
    return (
      !source.startsWith("persona:") ||
      this.personaById.has(source.slice("persona:".length))
    );
  }

  private countVersions(rows: Iterable<{ ref: string }>) {
    for (const { ref } of rows) {
      this.versions.set(ref, (this.versions.get(ref) ?? 0) + 1);
    }
  }

  private store(row: ParsedRow): Row {
    const inserted = this.db
      .insert(records)
      .values(row)
      .returning({ createdAt: records.createdAt, id: records.id })
      .get();
    if (inserted === undefined) {
      throw new Error("[DB] an appended record has no id");
    }
    return { ...row, ...inserted };
  }

  private project(row: Row) {
    this.versions.set(row.ref, (this.versions.get(row.ref) ?? 0) + 1);
    const state = applyRecord(this.refs.get(row.ref), row);
    this.refs.set(row.ref, state);
    const item = toFragment(row.ref, state);
    if (item === null) {
      this.corpus.delete(row.ref);
    } else {
      this.corpus.set(row.ref, item);
    }
  }

  private insert(row: ParsedRow): Row {
    const stored = this.store(row);
    this.project(stored);
    return stored;
  }

  private append(
    ref: string,
    fragment: string | null,
    op: Op,
    source: Source
  ): Row {
    return this.insert({ fragment, op, ref, source });
  }

  private write(
    ref: string,
    fragment: string,
    op: Op,
    source: Source
  ): Fragment {
    this.append(ref, fragment, op, source);
    const item = this.corpus.get(ref);
    if (item === undefined) {
      throw new Error(`[DB] ${ref} has no fragment after a write`);
    }
    return item;
  }

  private remove(ref: string, source: Source): Row {
    return this.append(ref, null, "forget", source);
  }

  remember(
    input: { fragment: string },
    source: Source
  ): Result<Fragment, InvalidInput | NotFound> {
    const parsed = inputSchemas.remember.safeParse(input);
    if (!parsed.success) {
      return err(invalid(parsed.error));
    }
    if (!this.isKnownSource(source)) {
      return personaNotFound();
    }
    return ok(
      this.write(freshRef(this.refs), parsed.data.fragment, "remember", source)
    );
  }

  revise(
    input: { fragment: string; ref: string },
    source: Source
  ): Result<Fragment, InvalidInput | NotFound> {
    const parsed = inputSchemas.revise.safeParse(input);
    if (!parsed.success) {
      return err(invalid(parsed.error));
    }
    const { fragment, ref } = parsed.data;
    if (!this.corpus.has(ref)) {
      return notFound();
    }
    if (!this.isKnownSource(source)) {
      return personaNotFound();
    }
    return ok(this.write(ref, fragment, "revise", source));
  }

  forget(
    input: { ref: string },
    source: Source
  ): Result<{ ref: string }, NotFound> {
    const { ref } = input;
    if (!this.corpus.has(ref)) {
      return notFound();
    }
    if (!this.isKnownSource(source)) {
      return personaNotFound();
    }
    this.remove(ref, source);
    return ok({ ref });
  }

  restore({
    id,
    ref,
  }: {
    id: number;
    ref: string;
  }): Result<Restored, NotFound> {
    const row = this.db
      .select()
      .from(records)
      .where(and(eq(records.id, id), eq(records.ref, ref)))
      .get();
    if (!row) {
      return notFound(id);
    }
    const op = this.corpus.has(ref) ? "revise" : "restore";
    const restored =
      row.fragment === null
        ? this.remove(ref, "user")
        : this.append(ref, row.fragment, op, "user");
    return ok({
      fragment: this.corpus.get(ref) ?? null,
      version: toVersion(restored),
      versions: this.versions.get(ref) ?? 1,
    });
  }

  purge(input: { ref: string }): Result<{ ref: string }, NotFound> {
    const { ref } = input;
    if (!this.refs.has(ref)) {
      return notFound();
    }
    this.db.delete(records).where(eq(records.ref, ref)).run();
    this.refs.delete(ref);
    this.versions.delete(ref);
    this.corpus.delete(ref);
    this.clearLogCursor();
    return ok({ ref });
  }

  private clearLogCursor() {
    this.db.delete(metadata).where(eq(metadata.key, LOG_CURSOR_KEY)).run();
    this.metadata.delete(LOG_CURSOR_KEY);
  }

  importLog(raw: {
    content: string;
    format: ImportFormat;
  }): Result<ImportResult, InvalidInput> {
    const input = importInputSchema.safeParse(raw);
    if (!input.success) {
      return err(invalid(input.error));
    }
    const { content, format } = input.data;
    const parsed = format === "ndjson" ? parseLog(content) : parseText(content);
    if ("issues" in parsed) {
      return err(invalidFile(parsed.issues));
    }
    const texts = new Set(
      [...this.corpus.values()].map(({ fragment }) => fragment)
    );
    const rows: ParsedRow[] = [];
    const conflicts: string[] = [];
    let imported = 0;
    let skipped = 0;
    if ("texts" in parsed) {
      const taken = new Set(this.refs.keys());
      for (const fragment of parsed.texts) {
        if (texts.has(fragment)) {
          skipped += 1;
          continue;
        }
        texts.add(fragment);
        const ref = freshRef(taken);
        taken.add(ref);
        rows.push({ fragment, op: "remember", ref, source: "user" });
        imported += 1;
      }
    } else {
      const last = new Map<string, string | null>();
      for (const { fragment, ref } of parsed.rows) {
        last.set(ref, fragment);
      }
      const accepted = new Set<string>();
      for (const [ref, text] of last) {
        if (this.refs.has(ref)) {
          if ((this.corpus.get(ref)?.fragment ?? null) === text) {
            skipped += 1;
          } else {
            conflicts.push(ref);
          }
          continue;
        }
        if (text !== null && texts.has(text)) {
          skipped += 1;
          continue;
        }
        accepted.add(ref);
        if (text !== null) {
          texts.add(text);
          imported += 1;
        }
      }
      rows.push(...parsed.rows.filter(({ ref }) => accepted.has(ref)));
    }
    // Ids follow the file's line order, and so does the projection.
    const stored: Row[] = [];
    this.ctx.storage.transactionSync(() => {
      if ("personas" in parsed) {
        this.addPersonas(parsed.personas);
      }
      for (const row of rows) {
        stored.push(this.store(row));
      }
    });
    for (const row of stored) {
      this.project(row);
    }
    this.clearLogCursor();
    return ok({ conflicts, imported, skipped });
  }

  exportLog({ history }: { history: boolean }): string {
    return serializeLog(
      this.personas(),
      history
        ? this.db.select().from(records).orderBy(asc(records.id)).all()
        : [...this.corpus.values()]
            .toSorted((a, b) => a.versionId - b.versionId)
            .map(({ fragment, ref, source, updatedAt }) => ({
              createdAt: Date.parse(updatedAt),
              fragment,
              ref,
              source,
            }))
    );
  }

  get(refs: string[]): Fragment[] {
    return refs.flatMap((ref) => {
      const item = this.corpus.get(ref);
      return item ? [item] : [];
    });
  }

  list(input: {
    cursor?: string | undefined;
    source?: Source | undefined;
    tag?: string[] | undefined;
  }): FragmentPage {
    return listFragments(
      [...this.corpus.values()].map((item) => ({
        ...item,
        versions: this.versions.get(item.ref) ?? 1,
      })),
      input
    );
  }

  readLog({ after }: { after?: number | undefined }): LogRead {
    const rows = this.db.select().from(records).orderBy(asc(records.id)).all();
    const cursor = rows.at(-1)?.id ?? 0;
    const folded = rows.filter(({ id }) => after === undefined || id <= after);
    const updates = rows.filter(({ id }) => after !== undefined && id > after);
    return {
      cursor,
      fragments: [...replay(folded).corpus.values()],
      records: updates.map(toVersion),
    };
  }

  history({ ref }: { ref: string }): Result<History, NotFound> {
    if (!this.refs.has(ref)) {
      return notFound();
    }
    const rows = this.db
      .select()
      .from(records)
      .where(eq(records.ref, ref))
      .orderBy(desc(records.id))
      .all();
    return ok({ versions: rows.map(toVersion) });
  }

  activity(input: {
    cursor?: string | undefined;
    source?: Source | undefined;
  }): ActivityPage {
    const { cursor: after, source } = activityInputSchema.parse(input);
    const rows = this.db
      .select()
      .from(records)
      .where(
        and(
          source && eq(records.source, source),
          after &&
            or(
              lt(records.createdAt, after[0]),
              and(eq(records.createdAt, after[0]), lt(records.id, after[1]))
            )
        )
      )
      .orderBy(desc(records.createdAt), desc(records.id))
      .limit(PAGE_SIZE + 1)
      .all();
    const entries = rows.slice(0, PAGE_SIZE).map((row) => ({
      ...toVersion(row),
      previous:
        row.op === "revise" || row.op === "forget"
          ? (this.db
              .select({ fragment: records.fragment })
              .from(records)
              .where(and(eq(records.ref, row.ref), lt(records.id, row.id)))
              .orderBy(desc(records.id))
              .limit(1)
              .get()?.fragment ?? null)
          : null,
    }));
    const last = entries.at(-1);
    return {
      entries,
      nextCursor:
        rows.length > PAGE_SIZE && last ? `${last.createdAt},${last.id}` : null,
    };
  }

  sources(): SourceSummary[] {
    return this.db
      .select({
        lastAt: max(records.createdAt),
        lastId: max(records.id),
        source: records.source,
      })
      .from(records)
      .where(isNotNull(records.source))
      .groupBy(records.source)
      .orderBy(desc(max(records.createdAt)), desc(max(records.id)))
      .all()
      .flatMap(({ lastAt, source }) =>
        source === null || lastAt === null
          ? []
          : [{ lastAt: new Date(lastAt).toISOString(), source }]
      );
  }

  forgotten(): ForgottenList {
    const fragments = [];
    for (const [ref, state] of this.refs) {
      if (state.active || state.text === null) {
        continue;
      }
      fragments.push({
        createdAt: new Date(state.createdAt).toISOString(),
        forgottenAt: new Date(state.forgottenAt).toISOString(),
        fragment: state.text.fragment,
        ref,
        source: state.text.source,
        updatedAt: new Date(state.text.updatedAt).toISOString(),
        versionId: state.text.id,
      });
    }
    fragments.sort(
      (a, b) =>
        b.forgottenAt.localeCompare(a.forgottenAt) || a.ref.localeCompare(b.ref)
    );
    return { fragments };
  }

  count(): number {
    return this.corpus.size;
  }

  personas(): Persona[] {
    return [...this.personaById.values()];
  }

  createPersona(input: { name: string }): Result<Persona, InvalidInput> {
    const parsed = personaInputSchemas.create.safeParse(input);
    if (!parsed.success) {
      return err(invalid(parsed.error));
    }
    const row = {
      archivedAt: null,
      createdAt: Date.now(),
      id: this.freshPersonaId(),
      name: parsed.data.name,
    };
    this.db.insert(personas).values(row).run();
    const persona = toPersona(row);
    this.personaById.set(persona.id, persona);
    return ok(persona);
  }

  renamePersona(input: {
    id: string;
    name: string;
  }): Result<Persona, InvalidInput | NotFound> {
    const parsed = personaInputSchemas.rename.safeParse(input);
    if (!parsed.success) {
      return err(invalid(parsed.error));
    }
    const { id, name } = parsed.data;
    const persona = this.personaById.get(id);
    if (!persona) {
      return personaNotFound();
    }
    this.db.update(personas).set({ name }).where(eq(personas.id, id)).run();
    const renamed = { ...persona, name };
    this.personaById.set(id, renamed);
    return ok(renamed);
  }

  setPersonaArchived(input: {
    archived: boolean;
    id: string;
  }): Result<Persona, NotFound> {
    const { archived, id } = personaInputSchemas.archive.parse(input);
    const persona = this.personaById.get(id);
    if (!persona) {
      return personaNotFound();
    }
    const archivedAt = archived
      ? (persona.archivedAt ?? new Date().toISOString())
      : null;
    this.db
      .update(personas)
      .set({ archivedAt: archivedAt === null ? null : Date.parse(archivedAt) })
      .where(eq(personas.id, id))
      .run();
    const updated = { ...persona, archivedAt };
    this.personaById.set(id, updated);
    return ok(updated);
  }

  readMetadata(key: string): Metadata | null {
    return this.metadata.get(key) ?? null;
  }

  patchMetadata(key: string, patch: Metadata): Metadata {
    const value = mergePatch(this.metadata.get(key), patch);
    this.db
      .insert(metadata)
      .values({ key, value })
      .onConflictDoUpdate({ set: { value }, target: metadata.key })
      .run();
    this.metadata.set(key, value);
    return value;
  }

  async diagnostics(): Promise<Diagnostics> {
    return {
      colo: await currentColo(),
      fragments: this.corpus.size,
      id: this.ctx.id.toString(),
      storageBytes: this.ctx.storage.sql.databaseSize,
    };
  }
}
