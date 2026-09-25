import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { customAlphabet } from "nanoid";
import { z } from "zod";

import type {
  Fragment,
  FragmentExport,
  ImportResult,
  RecallResult,
} from "../contract/memory";
import type { PluginView, Verdict } from "../contract/plugin";
import migrations from "../migrations/migrations.js";
import { plugins } from "../plugins";
import { fragments, pluginConfig } from "./db/schema";
import type { SeedFragment } from "./dev/corpus";
import {
  importInput,
  inputs,
  listFragments,
  recallCandidates,
  REF_ALPHABET,
  REF_LENGTH,
  truncate,
} from "./memory";
import {
  assertRegistry,
  createCtx,
  enabledTools,
  pluginUpdate,
  resolvePlugins,
  runAfterRecall,
  runVerdicts,
  viewPlugin,
} from "./plugin-host";
import type { PluginEnv, PluginState, PluginUpdate } from "./plugin-host";

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
    this.corpus.clear();
    for (const row of this.db.select().from(fragments).all()) {
      this.corpus.set(row.id, {
        createdAt: new Date(row.createdAt).toISOString(),
        fragment: row.content,
        ref: row.id,
        updatedAt: new Date(row.updatedAt).toISOString(),
      });
    }
    this.loadPlugins();
  }

  // Development only: replaces every fragment and plugin setting with the
  // given corpus. Production bundles keep only the throw.
  seed(items: SeedFragment[]) {
    if (!import.meta.env.DEV) {
      throw new Error("Seeding is available only in development builds");
    }
    this.ctx.storage.transactionSync(() => {
      this.db.delete(fragments).run();
      this.db.delete(pluginConfig).run();
      for (const { date, fragment } of items) {
        const at = Date.parse(`${date}T12:00:00Z`);
        this.db
          .insert(fragments)
          .values({
            content: fragment,
            createdAt: at,
            id: newRef(),
            updatedAt: at,
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
    const ref = freshRef(this.corpus);
    const now = Date.now();
    const item = {
      createdAt: new Date(now).toISOString(),
      fragment,
      ref,
      updatedAt: new Date(now).toISOString(),
    };
    this.db
      .insert(fragments)
      .values({ content: fragment, createdAt: now, id: ref, updatedAt: now })
      .run();
    this.corpus.set(ref, item);
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

  list(input: { cursor?: string }) {
    return listFragments(this.corpus.values(), input);
  }

  exportFragments(): FragmentExport {
    return {
      exportedAt: new Date().toISOString(),
      format: "memsys.fragments",
      fragments: [...this.corpus.values()].toSorted(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.ref.localeCompare(b.ref)
      ),
      version: 1,
    };
  }

  // A user migrating memory, not an agent writing: core validation only, no
  // write hooks, so fragments the old instance accepted are not re-judged.
  // Merge only; existing fragments are never changed. All or nothing.
  importFragments(raw: z.input<typeof importInput>): ImportResult | Problem {
    const parsed = importInput.safeParse(raw);
    if (!parsed.success) {
      return problem(parsed.error);
    }
    const items = parsed.data.fragments;
    const taken = new Set([
      ...this.corpus.keys(),
      ...items.flatMap(({ ref }) => (ref ? [ref] : [])),
    ]);
    const texts = new Set(
      [...this.corpus.values()].map(({ fragment }) => fragment)
    );
    const now = Date.now();
    const rows: (typeof fragments.$inferInsert)[] = [];
    const conflicts: string[] = [];
    let skipped = 0;
    for (const { createdAt, fragment, ref, updatedAt } of items) {
      const existing = ref ? this.corpus.get(ref) : undefined;
      if (ref && existing && existing.fragment !== fragment) {
        conflicts.push(ref);
        continue;
      }
      if (existing || texts.has(fragment)) {
        skipped += 1;
        continue;
      }
      texts.add(fragment);
      const id = ref ?? freshRef(taken);
      taken.add(id);
      rows.push({
        content: fragment,
        createdAt: createdAt ?? updatedAt ?? now,
        id,
        updatedAt: updatedAt ?? createdAt ?? now,
      });
    }
    this.ctx.storage.transactionSync(() => {
      for (const row of rows) {
        this.db.insert(fragments).values(row).run();
      }
    });
    for (const row of rows) {
      this.corpus.set(row.id, {
        createdAt: new Date(row.createdAt).toISOString(),
        fragment: row.content,
        ref: row.id,
        updatedAt: new Date(row.updatedAt).toISOString(),
      });
    }
    return { conflicts, imported: rows.length, skipped };
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
    const now = Date.now();
    const item = {
      ...existing,
      fragment,
      updatedAt: new Date(now).toISOString(),
    };
    this.db
      .update(fragments)
      .set({ content: fragment, updatedAt: now })
      .where(eq(fragments.id, ref))
      .run();
    this.corpus.set(ref, item);
    return withWarnings(item, verdict);
  }

  forget(input: { ref: string }): { ref: string } | null {
    const { ref } = inputs.forget.parse(input);
    if (!this.corpus.has(ref)) {
      return null;
    }
    this.db.delete(fragments).where(eq(fragments.id, ref)).run();
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
            "Plugin configuration changed elsewhere. Reload and try again.",
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
