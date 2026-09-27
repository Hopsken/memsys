import { DurableObject } from "cloudflare:workers";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { customAlphabet } from "nanoid";
import { z } from "zod";

import type {
  ForgottenList,
  Fragment,
  FragmentPage,
  History,
  ImportResult,
  RecallResult,
  Restored,
} from "../../contract/memory";
import type { PluginView, Verdict } from "../../contract/plugin";
import { plugins } from "../../plugins";
import type { SeedFragment } from "../dev/corpus";
import { parseLog, parseText, replay, serializeLog } from "../log";
import type { Issue, Row } from "../log";
import {
  importInput,
  inputs,
  listFragments,
  recallCandidates,
  REF_ALPHABET,
  REF_LENGTH,
  truncate,
} from "../memory";
import {
  assertRegistry,
  createCtx,
  enabledTools,
  pluginUpdate,
  resolvePlugins,
  runAfterRecall,
  runVerdicts,
  viewPlugin,
} from "../plugin-host";
import type { PluginEnv, PluginState, PluginUpdate } from "../plugin-host";
import { pluginConfig, records } from "./db/schema";
import migrations from "./migrations/migrations.js";

assertRegistry(plugins);

const newRef = customAlphabet(REF_ALPHABET, REF_LENGTH);

const freshRef = (taken: { has: (ref: string) => boolean }) => {
  let ref = newRef();
  while (taken.has(ref)) {
    ref = newRef();
  }
  return ref;
};

type ToolInput = z.input<z.ZodObject>;

export type WriteResult =
  | (Fragment & { warnings?: string[] })
  | { error: string };

interface Problem {
  error: string;
  issues: { path: string[]; message: string }[];
}

type PluginResponse = PluginView | PluginView[] | Problem | { error: string };

// Import problems name the file's line first.
const fileProblem = (issues: Issue[]): Problem => ({
  error: issues
    .map(({ message, path: [line, ...field] }) =>
      [`Line ${line}`, ...field].join(", ").concat(`: ${message}`)
    )
    .join("\n"),
  issues,
});

// Validation failures in the shape the client attaches to fields.
const problem = (error: z.ZodError): Problem => ({
  error: z.prettifyError(error),
  issues: error.issues.map(({ message, path }) => ({
    message,
    path: path.map(String),
  })),
});

const json = (body: PluginResponse, init?: ResponseInit) =>
  Response.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store" },
  });

const withWarnings = (item: Fragment, { warnings }: Verdict) =>
  warnings.length > 0 ? { ...item, warnings } : item;

const rejection = ({ rejections }: Verdict) =>
  rejections.length > 0 ? { error: rejections.join("\n") } : null;

export class MemoryDO extends DurableObject<Env> {
  private readonly db;
  private readonly corpus = new Map<string, Fragment>();
  // Every ref in the log, forgotten ones included, with its latest `at`.
  private heads = new Map<string, number>();
  // How many records each ref in the log has.
  private readonly versions = new Map<string, number>();
  private plugins: PluginState[] = [];
  private readonly pluginEnv: PluginEnv;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.db = drizzle(ctx.storage);
    this.pluginEnv = {
      ai: {
        run: async (model, input) =>
          z.json().parse(await env.AI.run(model, input)),
      },
      corpus: this.corpus,
    };
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
    const { corpus, heads } = replay(rows);
    // Plugins hold this map, so it is refilled rather than replaced.
    this.corpus.clear();
    for (const [ref, item] of corpus) {
      this.corpus.set(ref, item);
    }
    this.heads = heads;
    this.versions.clear();
    this.count(rows);
    this.loadPlugins();
  }

  private count(rows: Iterable<Row>) {
    for (const { ref } of rows) {
      this.versions.set(ref, (this.versions.get(ref) ?? 0) + 1);
    }
  }

  // Appends one record. `at` is a per-ref hybrid logical clock: the current
  // time, or one past the ref's previous record when the clock has not moved.
  private append(ref: string, fragment: string | null) {
    const at = Math.max(Date.now(), (this.heads.get(ref) ?? 0) + 1);
    this.db.insert(records).values({ at, fragment, ref }).run();
    this.heads.set(ref, at);
    this.versions.set(ref, (this.versions.get(ref) ?? 0) + 1);
    return at;
  }

  private write(ref: string, fragment: string): Fragment {
    const at = this.append(ref, fragment);
    const item = { at: new Date(at).toISOString(), fragment, ref };
    this.corpus.set(ref, item);
    return item;
  }

  // Development only: replaces every fragment and plugin setting with the
  // given corpus. Production bundles keep only the throw.
  seed(items: SeedFragment[]) {
    if (!import.meta.env.DEV) {
      throw new Error("Seeding is available only in development builds");
    }
    this.ctx.storage.transactionSync(() => {
      this.db.delete(records).run();
      this.db.delete(pluginConfig).run();
      for (const { date, fragment } of items) {
        this.db
          .insert(records)
          .values({
            at: Date.parse(`${date}T12:00:00Z`),
            fragment,
            ref: newRef(),
          })
          .run();
      }
    });
    this.load();
    return { fragments: items.length };
  }

  private loadPlugins() {
    this.plugins = resolvePlugins(
      plugins,
      this.db.select().from(pluginConfig).all()
    );
  }

  async remember(input: { fragment: string }): Promise<WriteResult> {
    const { fragment } = inputs.remember.parse(input);
    const verdict = await runVerdicts(
      this.plugins,
      this.pluginEnv,
      (plugin, ctx) => plugin.beforeRemember?.(ctx, fragment)
    );
    const rejected = rejection(verdict);
    if (rejected) {
      return rejected;
    }
    // A ref ever used, even if forgotten, is never handed out again.
    const item = this.write(freshRef(this.heads), fragment);
    return withWarnings(item, verdict);
  }

  async recall(
    raw: z.input<typeof inputs.recall>
  ): Promise<RecallResult | { error: string }> {
    const { candidates, input } = recallCandidates(this.corpus.values(), raw);
    const ranked = await runAfterRecall(
      this.plugins,
      this.pluginEnv,
      candidates,
      input
    );
    return "error" in ranked ? ranked : truncate(ranked, input.limit);
  }

  list(input: { cursor?: string }): FragmentPage {
    return listFragments(
      [...this.corpus.values()].map((item) => ({
        ...item,
        versions: this.versions.get(item.ref) ?? 1,
      })),
      input
    );
  }

  // Every record of one ref, newest first; null for a ref never written or
  // purged.
  history(input: { ref: string }): History | null {
    const { ref } = inputs.forget.parse(input);
    if (!this.heads.has(ref)) {
      return null;
    }
    const rows = this.db
      .select()
      .from(records)
      .where(eq(records.ref, ref))
      .orderBy(desc(records.at))
      .all();
    return {
      versions: rows.map(({ at, fragment }) => ({
        at: new Date(at).toISOString(),
        fragment,
        ref,
      })),
    };
  }

  // Forgotten refs with their last text, newest forgotten first. Low
  // traffic, so each ref's text is one indexed lookup rather than a cache.
  listForgotten(): ForgottenList {
    const fragments = [];
    for (const [ref, forgottenAt] of this.heads) {
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
      // A ref imported as only a forget has no text to bring back.
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

  // The user's own action, never an agent's: appends a copy of one record,
  // stamped now. Core validation only and no write hooks, since the text was
  // accepted once; a revision it lands on stays in the history.
  restore({ at, ref }: { at: number; ref: string }): Restored | null {
    const row = this.db
      .select()
      .from(records)
      .where(and(eq(records.ref, ref), eq(records.at, at)))
      .get();
    if (!row) {
      return null;
    }
    const restored =
      row.fragment === null
        ? this.remove(ref)
        : Date.parse(this.write(ref, row.fragment).at);
    return {
      at: new Date(restored).toISOString(),
      fragment: row.fragment,
      ref,
      versions: this.versions.get(ref) ?? 1,
    };
  }

  // NDJSON: the latest record of each current fragment, or the whole log.
  exportLog(history: boolean): string {
    return serializeLog(
      history
        ? this.db.select().from(records).all()
        : [...this.corpus.values()].map(({ at, fragment, ref }) => ({
            at: Date.parse(at),
            fragment,
            ref,
          }))
    );
  }

  // A user migrating memory, not an agent writing: core validation only, no
  // write hooks, so fragments the old instance accepted are not re-judged.
  // Merge only; existing fragments are never changed. All or nothing.
  importFragments(raw: z.input<typeof importInput>): ImportResult | Problem {
    const input = importInput.safeParse(raw);
    if (!input.success) {
      return problem(input.error);
    }
    const { content, format } = input.data;
    const parsed = format === "ndjson" ? parseLog(content) : parseText(content);
    if ("issues" in parsed) {
      return fileProblem(parsed.issues);
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
      const taken = new Set(this.heads.keys());
      for (const fragment of parsed.texts) {
        if (texts.has(fragment)) {
          skipped += 1;
          continue;
        }
        texts.add(fragment);
        const ref = freshRef(taken);
        taken.add(ref);
        rows.push({ at, fragment, ref });
        imported += 1;
      }
    } else {
      const { corpus, heads } = replay(parsed.rows);
      const history = Map.groupBy(parsed.rows, ({ ref }) => ref);
      for (const ref of heads.keys()) {
        const current = corpus.get(ref)?.fragment ?? null;
        // A ref known here, forgotten or not, is never changed by a file.
        if (this.heads.has(ref)) {
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
      for (const row of rows) {
        this.db.insert(records).values(row).run();
      }
    });
    this.count(rows);
    const { corpus, heads } = replay(rows);
    for (const [ref, at] of heads) {
      this.heads.set(ref, at);
    }
    for (const [ref, item] of corpus) {
      this.corpus.set(ref, item);
    }
    return { conflicts, imported, skipped };
  }

  async revise(
    input: z.input<typeof inputs.revise>
  ): Promise<WriteResult | null> {
    const { fragment, ref } = inputs.revise.parse(input);
    const existing = this.corpus.get(ref);
    if (!existing) {
      return null;
    }
    const verdict = await runVerdicts(
      this.plugins,
      this.pluginEnv,
      (plugin, ctx) => plugin.beforeRevise?.(ctx, existing, fragment)
    );
    const rejected = rejection(verdict);
    if (rejected) {
      return rejected;
    }
    // Hooks may await I/O, letting another request change the fragment meanwhile.
    if (this.corpus.get(ref) !== existing) {
      return {
        error: "Fragment changed while revising. Recall it and try again.",
      };
    }
    const item = this.write(ref, fragment);
    return withWarnings(item, verdict);
  }

  forget(input: { ref: string }): { ref: string } | null {
    const { ref } = inputs.forget.parse(input);
    if (!this.corpus.has(ref)) {
      return null;
    }
    this.remove(ref);
    return { ref };
  }

  // The text stays in the log; only purge removes it.
  private remove(ref: string) {
    const at = this.append(ref, null);
    this.corpus.delete(ref);
    return at;
  }

  // The user's own action, never an agent's: deletes every record of a ref,
  // forgotten or not, as if it never existed.
  purge(input: { ref: string }): { ref: string } | null {
    const { ref } = inputs.forget.parse(input);
    if (!this.heads.has(ref)) {
      return null;
    }
    this.db.delete(records).where(eq(records.ref, ref)).run();
    this.heads.delete(ref);
    this.versions.delete(ref);
    this.corpus.delete(ref);
    return { ref };
  }

  enabledTools(): string[] {
    return enabledTools(this.plugins).map(({ tool }) => tool.name);
  }

  async callTool(name: string, input: ToolInput): Promise<string> {
    const found = enabledTools(this.plugins).find(
      ({ tool }) => tool.name === name
    );
    if (!found) {
      throw new Error(`Tool ${name} is not enabled`);
    }
    const value = await found.tool.run(
      createCtx(found.state.config, this.pluginEnv),
      found.tool.input.parse(input)
    );
    // Tool output is plugin-defined; JSON keeps it serializable across RPC.
    return JSON.stringify(value);
  }

  // Plugin configs are plugin-defined JSON, which RPC types cannot map;
  // these return HTTP responses the worker passes through unchanged.
  listPlugins(): Response {
    return json(this.plugins.map(viewPlugin));
  }

  updatePlugin(name: string, input: PluginUpdate): Response {
    const state = this.plugins.find(({ plugin }) => plugin.name === name);
    if (!state) {
      return json({ error: `Unknown plugin: ${name}` }, { status: 404 });
    }
    const update = pluginUpdate.parse(input);
    if (update.updatedAt !== state.updatedAt) {
      return json(
        {
          error:
            "These settings were changed in another window. Reload to see the latest.",
        },
        { status: 409 }
      );
    }
    const parsed = state.plugin.config.safeParse(update.config);
    if (!parsed.success) {
      return json(problem(parsed.error), { status: 422 });
    }
    const row = {
      config: parsed.data,
      enabled: update.enabled,
      name,
      updatedAt: Date.now(),
    };
    this.db
      .insert(pluginConfig)
      .values(row)
      .onConflictDoUpdate({ set: row, target: pluginConfig.name })
      .run();
    this.loadPlugins();
    return json(this.view(name));
  }

  resetPlugin(name: string): Response {
    if (!this.plugins.some(({ plugin }) => plugin.name === name)) {
      return json({ error: `Unknown plugin: ${name}` }, { status: 404 });
    }
    this.db.delete(pluginConfig).where(eq(pluginConfig.name, name)).run();
    this.loadPlugins();
    return json(this.view(name));
  }

  private view(name: string): PluginView {
    const state = this.plugins.find(({ plugin }) => plugin.name === name);
    if (!state) {
      throw new Error(`Unknown plugin: ${name}`);
    }
    return viewPlugin(state);
  }
}
