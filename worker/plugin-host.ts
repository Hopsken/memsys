import { z } from "zod";

import type { Fragment, RecallInput, RecallItem } from "../contract/memory";
import { PluginAbortError } from "../contract/plugin";
import type {
  Ctx,
  Json,
  Plugin,
  PluginView,
  Verdict,
} from "../contract/plugin";
import { extractAnchors, inputs } from "./memory";

export interface StoredConfig {
  name: string;
  enabled: boolean;
  config: Json;
  updatedAt: number;
}

export interface PluginState {
  plugin: Plugin<Json>;
  enabled: boolean;
  config: Json;
  status: PluginView["status"];
  updatedAt: number | null;
}

const NO_VERDICT: Verdict = { rejections: [], warnings: [] };

// Tool plugins are additive: they cannot shadow core tools or each other.
export const assertRegistry = (plugins: readonly Plugin<Json>[]) => {
  const names = new Set<string>();
  const tools = new Set(Object.keys(inputs));
  for (const plugin of plugins) {
    if (names.has(plugin.name)) {
      throw new Error(`Duplicate plugin name: ${plugin.name}`);
    }
    names.add(plugin.name);
    for (const tool of plugin.tools ?? []) {
      if (tools.has(tool.name)) {
        throw new Error(`Plugin ${plugin.name} redefines tool ${tool.name}`);
      }
      tools.add(tool.name);
    }
  }
};

// Effective config = stored choice if it still parses, else the plugin's defaults.
export const resolvePlugins = (
  plugins: readonly Plugin<Json>[],
  stored: readonly StoredConfig[]
): PluginState[] =>
  plugins.map((plugin) => {
    const row = stored.find((item) => item.name === plugin.name);
    if (!row) {
      return { ...plugin.defaults, plugin, status: "default", updatedAt: null };
    }
    const parsed = plugin.config.safeParse(row.config);
    if (!parsed.success) {
      console.error({
        error: z.prettifyError(parsed.error),
        event: "plugin.config.invalid",
        plugin: plugin.name,
      });
      return {
        config: plugin.defaults.config,
        enabled: row.enabled,
        plugin,
        status: "invalid",
        updatedAt: row.updatedAt,
      };
    }
    return {
      config: parsed.data,
      enabled: row.enabled,
      plugin,
      status: "custom",
      updatedAt: row.updatedAt,
    };
  });

export const createCtx = <C>(
  config: C,
  corpus: ReadonlyMap<string, Fragment>
): Ctx<C> => ({
  config,
  corpus,
  index: {
    anchors: (ref) => extractAnchors(corpus.get(ref)?.fragment ?? ""),
  },
});

// Hooks run in parallel. A failing hook is skipped; PluginAbort rejects the write.
export const runVerdicts = async (
  states: readonly PluginState[],
  corpus: ReadonlyMap<string, Fragment>,
  hook: (plugin: Plugin<Json>, ctx: Ctx<Json>) => Promise<Verdict> | undefined
): Promise<Verdict> => {
  const verdicts = await Promise.all(
    states
      .filter((state) => state.enabled)
      .map(async ({ config, plugin }) => {
        try {
          return (await hook(plugin, createCtx(config, corpus))) ?? NO_VERDICT;
        } catch (error) {
          if (error instanceof PluginAbortError) {
            return {
              rejections: [`${plugin.name}: ${error.reason}`],
              warnings: [],
            };
          }
          console.error({
            error: String(error),
            event: "plugin.hook.failed",
            plugin: plugin.name,
          });
          return NO_VERDICT;
        }
      })
  );
  return {
    rejections: verdicts.flatMap((verdict) => verdict.rejections),
    warnings: verdicts.flatMap((verdict) => verdict.warnings),
  };
};

// Hooks run in registry order, each on the previous output. A hook may only
// reorder or drop items; a failing hook passes its input through, and
// PluginAbort fails the recall.
export const runAfterRecall = async (
  states: readonly PluginState[],
  corpus: ReadonlyMap<string, Fragment>,
  candidates: readonly RecallItem[],
  input: RecallInput
): Promise<RecallItem[] | { error: string }> => {
  let items = [...candidates];
  for (const { config, enabled, plugin } of states) {
    if (!enabled || !plugin.afterRecall) {
      continue;
    }
    try {
      const current = new Map(items.map((item) => [item.ref, item]));
      // Sequential by design: each hook sees the previous hook's output.
      // oxlint-disable-next-line no-await-in-loop
      const next = await plugin.afterRecall(
        createCtx(config, corpus),
        items,
        input
      );
      items = [...new Set(next.map((item) => item.ref))].flatMap((ref) => {
        const item = current.get(ref);
        return item ? [item] : [];
      });
    } catch (error) {
      if (error instanceof PluginAbortError) {
        return { error: `${plugin.name}: ${error.reason}` };
      }
      console.error({
        error: String(error),
        event: "plugin.hook.failed",
        plugin: plugin.name,
      });
    }
  }
  return items;
};

export const enabledTools = (states: readonly PluginState[]) =>
  states
    .filter((state) => state.enabled)
    .flatMap((state) =>
      (state.plugin.tools ?? []).map((tool) => ({ state, tool }))
    );

export const viewPlugin = ({
  config,
  enabled,
  plugin,
  status,
  updatedAt,
}: PluginState): PluginView => ({
  config,
  defaults: plugin.defaults,
  description: plugin.description,
  enabled,
  name: plugin.name,
  // SAFETY: toJSONSchema emits plain JSON objects.
  schema: z.toJSONSchema(plugin.config, {
    unrepresentable: "any",
  }) as PluginView["schema"],
  status,
  title: plugin.title,
  tools: (plugin.tools ?? []).map((tool) => tool.name),
  updatedAt,
});

export type PluginUpdate = z.input<typeof pluginUpdate>;

export const pluginUpdate = z
  .object({
    config: z.json(),
    enabled: z.boolean(),
    // The updatedAt the client last read; null when it saw defaults.
    updatedAt: z.int().nullable(),
  })
  .strict();
