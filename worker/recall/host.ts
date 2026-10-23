import type {
  RecallInput,
  RecallItem,
  RecallResult,
} from "../../contract/memory";
import { PluginAbortError } from "../../contract/plugin";
import type { Json, Plugin, RecallStage } from "../../contract/plugin";
import { createCtx } from "../plugin-host";
import type { PluginEnv, PluginState } from "../plugin-host";

// A built-in stage always runs; a plugin's stage runs when the owner has
// that plugin on.
export type Step = { builtin: RecallStage<unknown> } | { plugin: string };
export type Pipeline = readonly Step[];

// No correct pipeline returns more; it keeps a broken stage from flooding the
// agent's context.
const RECALL_CEILING = 40;

const pluginName = (step: Step) => ("plugin" in step ? step.plugin : null);

// Every plugin with a recall stage has exactly one place in the pipeline,
// and every name in it is such a plugin.
export const assertPipeline = (
  pipeline: Pipeline,
  plugins: readonly Plugin<Json>[]
) => {
  const named = pipeline.flatMap((step) => pluginName(step) ?? []);
  const staged = plugins.filter((plugin) => plugin.recall);
  for (const name of named) {
    if (!staged.some((plugin) => plugin.name === name)) {
      throw new Error(`Pipeline names ${name}, which has no recall stage`);
    }
  }
  for (const plugin of staged) {
    if (named.filter((name) => name === plugin.name).length !== 1) {
      throw new Error(`Plugin ${plugin.name} must appear once in the pipeline`);
    }
  }
};

const runStage = (
  step: Step,
  states: readonly PluginState[],
  env: PluginEnv,
  items: readonly RecallItem[],
  input: RecallInput
) => {
  if ("builtin" in step) {
    return step.builtin(createCtx(null, env), items, input);
  }
  const state = states.find((item) => item.plugin.name === step.plugin);
  if (!state?.enabled || !state.plugin.recall) {
    return null;
  }
  return state.plugin.recall(createCtx(state.config, env), items, input);
};

// Runs the stages in order, each on the previous stage's output, and enforces
// what no stage can be trusted with: text comes only from the corpus,
// `truncated` never clears, and the result stays under a ceiling. A failing
// plugin stage passes its input through; PluginAbort fails the recall. A
// failing built-in stage is a bug and throws.
export const runRecall = async (
  pipeline: Pipeline,
  states: readonly PluginState[],
  env: PluginEnv,
  input: RecallInput
): Promise<RecallResult | { error: string }> => {
  let items: RecallItem[] = [];
  let truncated = false;
  for (const step of pipeline) {
    try {
      // Sequential by design: each stage sees the previous stage's output.
      // oxlint-disable-next-line no-await-in-loop
      const result = await runStage(step, states, env, items, input);
      if (result) {
        const seen = new Set<string>();
        items = result.items.flatMap(({ ref, via }) => {
          const fragment = env.corpus.get(ref);
          if (!fragment || seen.has(ref)) {
            return [];
          }
          seen.add(ref);
          return [via ? { ...fragment, via } : { ...fragment }];
        });
        truncated ||= result.truncated === true;
      }
    } catch (error) {
      const plugin = pluginName(step);
      if (!plugin) {
        throw error;
      }
      if (error instanceof PluginAbortError) {
        return { error: `${plugin}: ${error.reason}` };
      }
      console.error({
        error: String(error),
        event: "plugin.hook.failed",
        plugin,
      });
    }
  }
  if (items.length > RECALL_CEILING) {
    console.error({ count: items.length, event: "recall.ceiling" });
    return { fragments: items.slice(0, RECALL_CEILING), truncated: true };
  }
  return { fragments: items, truncated };
};
