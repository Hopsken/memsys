import type {
  RecallFailure,
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
export type Step =
  | { builtin: string; stage: RecallStage<null> }
  | { plugin: Plugin<Json> };
export type Pipeline = readonly Step[];

// No correct pipeline returns more; it keeps a broken stage from flooding the
// agent's context.
const RECALL_CEILING = 40;

// Every registered plugin with a recall stage has exactly one place in the
// pipeline, and every plugin in it is registered and has a recall stage.
export const assertPipeline = (
  pipeline: Pipeline,
  plugins: readonly Plugin<Json>[]
) => {
  const named = pipeline.flatMap((step) =>
    "plugin" in step ? [step.plugin] : []
  );
  for (const plugin of named) {
    if (!plugin.recall || !plugins.includes(plugin)) {
      throw new Error(
        `Pipeline names ${plugin.name}, which has no recall stage`
      );
    }
  }
  for (const plugin of plugins.filter((item) => item.recall)) {
    if (named.filter((item) => item === plugin).length !== 1) {
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
    return step.stage(createCtx(null, env), items, input);
  }
  const state = states.find((item) => item.plugin.name === step.plugin.name);
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
): Promise<RecallResult | RecallFailure> => {
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
          // An empty `via` would turn a cue match into an association.
          return [via?.length ? { ...fragment, via } : { ...fragment }];
        });
        truncated ||= result.truncated === true;
      }
    } catch (error) {
      if ("builtin" in step) {
        console.error({
          error: String(error),
          event: "recall.stage.failed",
          stage: step.builtin,
        });
        throw error;
      }
      const plugin = step.plugin.name;
      if (error instanceof PluginAbortError) {
        return {
          error: `${plugin}: ${error.reason}`,
          ...(error.retry !== undefined && { retry: error.retry }),
        };
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
