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
import { PERSONA_ID_LENGTH, REF_ALPHABET, REF_LENGTH } from "./model";
import type { Author, Fragment, Op, Persona, Version } from "./model";
import { FragmentIndex } from "./search";
import type {
  ActivityPage,
  AnchorCount,
  Association,
  AuthorSummary,
  Diagnostics,
  ForgottenList,
  FragmentPage,
  History,
  ImportFormat,
  ImportResult,
  InvalidInput,
  MemoryCore,
  Metadata,
  NotFound,
  Restored,
  SearchHit,
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

const toVersion = ({ at, by, fragment, op, ref }: Row): Version => ({
  at: new Date(at).toISOString(),
  by,
  fragment,
  op,
  ref,
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
  private readonly index = new FragmentIndex();
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
    this.index.clear();
    for (const item of corpus.values()) {
      this.index.set(item);
    }
    this.latestAtByRef = latestAtByRef;
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

  private isKnownAuthor(by: Author) {
    return (
      !by.startsWith("persona:") ||
      this.personaById.has(by.slice("persona:".length))
    );
  }

  private countVersions(rows: Iterable<Row>) {
    for (const { ref } of rows) {
      this.versions.set(ref, (this.versions.get(ref) ?? 0) + 1);
    }
  }

  private nextAt(ref: string) {
    return Math.max(Date.now(), (this.latestAtByRef.get(ref) ?? 0) + 1);
  }

  private append(ref: string, fragment: string | null, op: Op, by: Author) {
    const at = this.nextAt(ref);
    this.db.insert(records).values({ at, by, fragment, op, ref }).run();
    this.latestAtByRef.set(ref, at);
    this.versions.set(ref, (this.versions.get(ref) ?? 0) + 1);
    return at;
  }

  private write(ref: string, fragment: string, op: Op, by: Author): Fragment {
    const at = this.append(ref, fragment, op, by);
    const item = { at: new Date(at).toISOString(), fragment, ref };
    this.index.set(item);
    return item;
  }

  private remove(ref: string, by: Author) {
    const at = this.append(ref, null, "forget", by);
    this.index.delete(ref);
    return at;
  }

  remember(
    input: { fragment: string },
    by: Author
  ): Result<Fragment, InvalidInput | NotFound> {
    const parsed = inputSchemas.remember.safeParse(input);
    if (!parsed.success) {
      return err(invalid(parsed.error));
    }
    if (!this.isKnownAuthor(by)) {
      return personaNotFound();
    }
    return ok(
      this.write(
        freshRef(this.latestAtByRef),
        parsed.data.fragment,
        "remember",
        by
      )
    );
  }

  revise(
    input: { fragment: string; ref: string },
    by: Author
  ): Result<Fragment, InvalidInput | NotFound> {
    const parsed = inputSchemas.revise.safeParse(input);
    if (!parsed.success) {
      return err(invalid(parsed.error));
    }
    const { fragment, ref } = parsed.data;
    if (!this.index.has(ref)) {
      return notFound();
    }
    if (!this.isKnownAuthor(by)) {
      return personaNotFound();
    }
    return ok(this.write(ref, fragment, "revise", by));
  }

  forget(
    input: { ref: string },
    by: Author
  ): Result<{ ref: string }, NotFound> {
    const { ref } = input;
    if (!this.index.has(ref)) {
      return notFound();
    }
    if (!this.isKnownAuthor(by)) {
      return personaNotFound();
    }
    this.remove(ref, by);
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
    const op = this.index.has(ref) ? "revise" : "restore";
    const restored =
      row.fragment === null
        ? this.remove(ref, "user")
        : Date.parse(this.write(ref, row.fragment, op, "user").at);
    return ok({
      at: new Date(restored).toISOString(),
      by: "user",
      fragment: row.fragment,
      op: row.fragment === null ? "forget" : op,
      ref,
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
    this.index.delete(ref);
    return ok({ ref });
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
      [...this.index.values()].map(({ fragment }) => fragment)
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
        rows.push({ at, by: "user", fragment, op: "remember", ref });
        imported += 1;
      }
    } else {
      const { corpus, latestAtByRef } = replay(parsed.rows);
      const history = Map.groupBy(parsed.rows, ({ ref }) => ref);
      for (const ref of latestAtByRef.keys()) {
        const current = corpus.get(ref)?.fragment ?? null;
        if (this.latestAtByRef.has(ref)) {
          if ((this.index.get(ref)?.fragment ?? null) === current) {
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
    const { corpus, latestAtByRef } = replay(rows);
    for (const [ref, at] of latestAtByRef) {
      this.latestAtByRef.set(ref, at);
    }
    for (const item of corpus.values()) {
      this.index.set(item);
    }
    return ok({ conflicts, imported, skipped });
  }

  exportLog({ history }: { history: boolean }): string {
    return serializeLog(
      this.personas(),
      history
        ? this.db.select().from(records).all()
        : [...this.index.values()].map(({ at, fragment, ref }) => ({
            at: Date.parse(at),
            fragment,
            ref,
          }))
    );
  }

  get(refs: string[]): Fragment[] {
    return refs.flatMap((ref) => {
      const item = this.index.get(ref);
      return item ? [item] : [];
    });
  }

  list(input: {
    cursor?: string | undefined;
    tag?: string[] | undefined;
  }): FragmentPage {
    return listFragments(
      [...this.index.values()].map((item) => ({
        ...item,
        versions: this.versions.get(item.ref) ?? 1,
      })),
      input
    );
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
    by?: Author | undefined;
    cursor?: string | undefined;
  }): ActivityPage {
    const { by, cursor: after } = activityInputSchema.parse(input);
    const rows = this.db
      .select()
      .from(records)
      .where(
        and(
          by && eq(records.by, by),
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

  authors(): AuthorSummary[] {
    return this.db
      .select({ by: records.by, lastAt: max(records.at) })
      .from(records)
      .where(isNotNull(records.by))
      .groupBy(records.by)
      .orderBy(desc(max(records.at)))
      .all()
      .flatMap(({ by, lastAt }) =>
        by === null || lastAt === null
          ? []
          : [{ by, lastAt: new Date(lastAt).toISOString() }]
      );
  }

  forgotten(): ForgottenList {
    const fragments = [];
    for (const [ref, forgottenAt] of this.latestAtByRef) {
      if (this.index.has(ref)) {
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
        });
      }
    }
    fragments.sort(
      (a, b) =>
        b.forgottenAt.localeCompare(a.forgottenAt) || a.ref.localeCompare(b.ref)
    );
    return { fragments };
  }

  search(terms: string[]): SearchHit[] {
    return this.index.search(terms);
  }

  associated(keys: string[]): Association[] {
    return this.index.associated(keys);
  }

  anchors(): AnchorCount[] {
    return this.index.anchors();
  }

  count(): number {
    return this.index.size;
  }

  snapshot(): Fragment[] {
    return [...this.index.values()];
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
      fragments: this.index.size,
      id: this.ctx.id.toString(),
      storageBytes: this.ctx.storage.sql.databaseSize,
    };
  }
}
