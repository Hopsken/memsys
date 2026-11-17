import { DurableObject } from "cloudflare:workers";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNotNull,
  lt,
  max,
  or,
  sql,
} from "drizzle-orm";
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
import { parseLog, parseText, replay, serializeLog } from "./log";
import type { Row } from "./log";
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

const notFound = (at?: number): { error: NotFound; ok: false } =>
  err(
    at === undefined
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

const toVersion = ({ at, fragment, op, ref, source }: Row): Version => ({
  at: new Date(at).toISOString(),
  fragment,
  op,
  ref,
  source,
});

const latestAtOf = (rows: Iterable<{ at: number }>, floor = 0): number => {
  let latest = floor;
  for (const { at } of rows) {
    latest = Math.max(latest, at);
  }
  return latest;
};

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
  private latestAt = 0;
  private latestAtByRef = new Map<string, number>();
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
    const rows = this.db.select().from(records).all();
    const { corpus, latestAtByRef } = replay(rows);
    this.corpus.clear();
    for (const [ref, item] of corpus) {
      this.corpus.set(ref, item);
    }
    this.latestAtByRef = latestAtByRef;
    this.latestAt = latestAtOf(rows);
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

  private countVersions(rows: Iterable<Row>) {
    for (const { ref } of rows) {
      this.versions.set(ref, (this.versions.get(ref) ?? 0) + 1);
    }
  }

  private nextAt() {
    const at = Math.max(Date.now(), this.latestAt + 1);
    this.latestAt = at;
    return at;
  }

  private append(ref: string, fragment: string | null, op: Op, source: Source) {
    const at = this.nextAt();
    this.db.insert(records).values({ at, fragment, op, ref, source }).run();
    this.latestAtByRef.set(ref, at);
    this.versions.set(ref, (this.versions.get(ref) ?? 0) + 1);
    return at;
  }

  private write(
    ref: string,
    fragment: string,
    op: Op,
    source: Source
  ): Fragment {
    const at = this.append(ref, fragment, op, source);
    const item = { at: new Date(at).toISOString(), fragment, ref, source };
    this.corpus.set(item.ref, item);
    return item;
  }

  private remove(ref: string, source: Source) {
    const at = this.append(ref, null, "forget", source);
    this.corpus.delete(ref);
    return at;
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
      this.write(
        freshRef(this.latestAtByRef),
        parsed.data.fragment,
        "remember",
        source
      )
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
    at,
    ref,
  }: {
    at: number;
    ref: string;
  }): Result<Restored, NotFound> {
    const row = this.db
      .select()
      .from(records)
      .where(and(eq(records.ref, ref), eq(records.at, at)))
      .get();
    if (!row) {
      return notFound(at);
    }
    const op = this.corpus.has(ref) ? "revise" : "restore";
    const restored =
      row.fragment === null
        ? this.remove(ref, "user")
        : Date.parse(this.write(ref, row.fragment, op, "user").at);
    return ok({
      at: new Date(restored).toISOString(),
      fragment: row.fragment,
      op: row.fragment === null ? "forget" : op,
      ref,
      source: "user",
      versions: this.versions.get(ref) ?? 1,
    });
  }

  purge(input: { ref: string }): Result<{ ref: string }, NotFound> {
    const { ref } = input;
    if (!this.latestAtByRef.has(ref)) {
      return notFound();
    }
    this.db.delete(records).where(eq(records.ref, ref)).run();
    this.latestAtByRef.delete(ref);
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
    const rows: Row[] = [];
    const conflicts: string[] = [];
    let imported = 0;
    let skipped = 0;
    if ("texts" in parsed) {
      const at = Date.now();
      const taken = new Set(this.latestAtByRef.keys());
      for (const fragment of parsed.texts) {
        if (texts.has(fragment)) {
          skipped += 1;
          continue;
        }
        texts.add(fragment);
        const ref = freshRef(taken);
        taken.add(ref);
        rows.push({ at, fragment, op: "remember", ref, source: "user" });
        imported += 1;
      }
    } else {
      const { corpus, latestAtByRef } = replay(parsed.rows);
      const history = Map.groupBy(parsed.rows, ({ ref }) => ref);
      for (const ref of latestAtByRef.keys()) {
        const current = corpus.get(ref)?.fragment ?? null;
        if (this.latestAtByRef.has(ref)) {
          if ((this.corpus.get(ref)?.fragment ?? null) === current) {
            skipped += 1;
          } else {
            conflicts.push(ref);
          }
          continue;
        }
        if (current !== null && texts.has(current)) {
          skipped += 1;
          continue;
        }
        rows.push(...(history.get(ref) ?? []));
        if (current !== null) {
          texts.add(current);
          imported += 1;
        }
      }
    }
    this.ctx.storage.transactionSync(() => {
      if ("personas" in parsed) {
        this.addPersonas(parsed.personas);
      }
      for (const row of rows) {
        this.db.insert(records).values(row).run();
      }
    });
    this.countVersions(rows);
    this.latestAt = latestAtOf(rows, this.latestAt);
    const { corpus, latestAtByRef } = replay(rows);
    for (const [ref, at] of latestAtByRef) {
      this.latestAtByRef.set(ref, at);
    }
    for (const item of corpus.values()) {
      this.corpus.set(item.ref, item);
    }
    this.clearLogCursor();
    return ok({ conflicts, imported, skipped });
  }

  exportLog({ history }: { history: boolean }): string {
    return serializeLog(
      this.personas(),
      history
        ? this.db.select().from(records).all()
        : [...this.corpus.values()].map(({ at, fragment, ref, source }) => ({
            at: Date.parse(at),
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
    const rows = this.db
      .select({
        at: records.at,
        fragment: records.fragment,
        op: records.op,
        ref: records.ref,
        source: records.source,
      })
      .from(records)
      .orderBy(records.at, records.ref)
      .all();
    const cursor = rows.at(-1)?.at ?? 0;
    const folded = rows.filter(({ at }) => after === undefined || at <= after);
    const updates = rows.filter(({ at }) => after !== undefined && at > after);
    return {
      cursor,
      fragments: [...replay(folded).corpus.values()],
      records: updates.map(toVersion),
    };
  }

  history({ ref }: { ref: string }): Result<History, NotFound> {
    if (!this.latestAtByRef.has(ref)) {
      return notFound();
    }
    const rows = this.db
      .select()
      .from(records)
      .where(eq(records.ref, ref))
      .orderBy(desc(records.at))
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
              lt(records.at, Date.parse(after[0])),
              and(
                eq(records.at, Date.parse(after[0])),
                gt(records.ref, after[1])
              )
            )
        )
      )
      .orderBy(desc(records.at), asc(records.ref))
      .limit(PAGE_SIZE + 1)
      .all();
    const entries = rows.slice(0, PAGE_SIZE).map((row) => ({
      ...toVersion(row),
      previous:
        row.op === "revise" || row.op === "forget"
          ? (this.db
              .select({ fragment: records.fragment })
              .from(records)
              .where(and(eq(records.ref, row.ref), lt(records.at, row.at)))
              .orderBy(desc(records.at))
              .limit(1)
              .get()?.fragment ?? null)
          : null,
    }));
    const last = entries.at(-1);
    return {
      entries,
      nextCursor:
        rows.length > PAGE_SIZE && last ? `${last.at},${last.ref}` : null,
    };
  }

  sources(): SourceSummary[] {
    return this.db
      .select({ lastAt: max(records.at), source: records.source })
      .from(records)
      .where(isNotNull(records.source))
      .groupBy(records.source)
      .orderBy(desc(max(records.at)))
      .all()
      .flatMap(({ lastAt, source }) =>
        source === null || lastAt === null
          ? []
          : [{ lastAt: new Date(lastAt).toISOString(), source }]
      );
  }

  forgotten(): ForgottenList {
    const fragments = [];
    for (const [ref, forgottenAt] of this.latestAtByRef) {
      if (this.corpus.has(ref)) {
        continue;
      }
      const last = this.db
        .select()
        .from(records)
        .where(and(eq(records.ref, ref), isNotNull(records.fragment)))
        .orderBy(desc(records.at))
        .limit(1)
        .get();
      if (last?.fragment) {
        fragments.push({
          at: new Date(last.at).toISOString(),
          forgottenAt: new Date(forgottenAt).toISOString(),
          fragment: last.fragment,
          ref,
          source: last.source,
        });
      }
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
