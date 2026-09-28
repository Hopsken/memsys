import { z } from "zod";

import type { RecallInput, RecallItem } from "../contract/memory";
import { definePlugin, PluginAbortError } from "../contract/plugin";
import type { Ctx, Json } from "../contract/plugin";
import { RECALL_MAX } from "../lib/recall";

// Relevance gate per RFC 1 Stage 2: one independent noul per candidate, so
// "nothing is relevant" is a possible answer. Fail-closed: an unchecked
// memory must never pass as checked, so any error fails the recall.
export const JEV_MODEL = "typesafe/jev";
// Per request; a slow recall costs less than a misleading one.
export const JEV_TIMEOUT_MS = 10_000;
// One request fits Jev's 32k-token context even in CJK text: up to 12,000
// characters of fragments (~18k tokens), 40 questions (~4k), and the cue and
// context (~2k). Core bounds how many candidates there are.
export const JEV_BATCH = 40;
export const JEV_BATCH_CHARS = 12_000;

// Named levels instead of a raw probability: 0.45 vs 0.48 means nothing to a
// user. Measured on real recalls, misses score ≲0.15 and hits ≳0.9.
export const STRICTNESS = { high: 0.5, low: 0.1, max: 0.7, medium: 0.3 };

const config = z.object({
  matches: z.boolean().meta({
    description:
      "Also check memories that contain the search words. Off checks only related memories.",
    title: "Check direct matches",
  }),
  // Defaulted so rows saved with the earlier numeric `threshold` still parse.
  strictness: z.enum(["low", "medium", "high", "max"]).default("medium").meta({
    description:
      "How much to hide. Low hides only clear misses; Max keeps only strong matches.",
    title: "Strictness",
  }),
});

type Config = z.infer<typeof config>;

const answers = z.object({
  answers: z.record(z.string(), z.object({ noul: z.number().min(0).max(1) })),
});
// Workers AI wraps Jev's body in a gateway envelope ({ state, result, … });
// the model docs show it bare. Accept both.
const response = z.union([
  answers,
  z.object({ result: answers }).transform(({ result }) => result),
]);

const parseScores = (value: Json) => {
  const parsed = response.safeParse(value);
  if (!parsed.success) {
    const keys = Object.keys(z.looseObject({}).safeParse(value).data ?? {});
    throw new Error(`Unexpected Jev response (keys: ${keys.join(", ")})`);
  }
  return parsed.data.answers;
};

// Keys are refs; Jev does not show keys to the model, so they are safe ids.
const question = (ref: string) => ({
  criteria: {
    false:
      "The fragment is unrelated, or related only by sharing a broad topic tag.",
    true: "The fragment states something the agent would want in front of it right now.",
  },
  instructions: `Would candidates.${ref} be useful to an agent whose current cue is \`cue\` and whose current task is \`context\`?`,
  type: "noul",
});

const withTimeout = async <T>(promise: Promise<T>, ms: number) => {
  const { promise: expired, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => reject(new Error(`Jev timed out after ${ms} ms`)),
    ms
  );
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
};

// One request per batch. Any failure, or a candidate left unanswered, aborts.
const judge = async (
  ai: Ctx<Config>["ai"],
  batch: readonly RecallItem[],
  { context, cue }: RecallInput
) => {
  try {
    const output = await withTimeout(
      ai.run(JEV_MODEL, {
        questions: Object.fromEntries(
          batch.map((item) => [item.ref, question(item.ref)])
        ),
        state: {
          candidates: Object.fromEntries(
            batch.map((item) => [item.ref, item.fragment])
          ),
          context: context ?? "",
          cue,
        },
      }),
      JEV_TIMEOUT_MS
    );
    const scores = parseScores(output);
    return batch.map(({ ref }) => {
      const score = scores[ref]?.noul;
      if (score === undefined) {
        throw new Error(`Jev left ${ref} unanswered`);
      }
      return score;
    });
  } catch (error) {
    console.error({
      error: String(error),
      event: "plugin.hook.failed",
      plugin: "jev",
    });
    throw new PluginAbortError(
      "Couldn't check which memories are relevant. Try again later."
    );
  }
};

// The next batch from `start`: at least one item, then as many as fit.
const nextBatch = (queue: readonly RecallItem[], start: number) => {
  const batch: RecallItem[] = [];
  let chars = 0;
  for (const item of queue.slice(start, start + JEV_BATCH)) {
    chars += item.fragment.length;
    if (batch.length > 0 && chars > JEV_BATCH_CHARS) {
      break;
    }
    batch.push(item);
  }
  return batch;
};

const gate = async (
  { ai, config: { matches, strictness } }: Ctx<Config>,
  items: readonly RecallItem[],
  input: RecallInput
) => {
  const gated = (item: RecallItem) => matches || Boolean(item.via);
  const threshold = STRICTNESS[strictness];
  const queue = items.filter(gated);
  const passed = new Set<string>();
  let judged = 0;
  // Items before the first unjudged one are settled: kept if ungated or passed.
  const settled = () => {
    const next = queue[judged];
    return items
      .slice(0, next ? items.indexOf(next) : items.length)
      .filter((item) => !gated(item) || passed.has(item.ref));
  };
  // Judge in order until more than RECALL_MAX are settled: the same result as
  // judging everything, so `hasMore` stays exact. The unjudged rest is
  // dropped. Holds only while no later hook drops items.
  while (judged < queue.length && settled().length <= RECALL_MAX) {
    const batch = nextBatch(queue, judged);
    // Sequential by design: stop as soon as a page is full.
    // oxlint-disable-next-line no-await-in-loop
    const scores = await judge(ai, batch, input);
    for (const [index, item] of batch.entries()) {
      if ((scores[index] ?? 0) >= threshold) {
        passed.add(item.ref);
      }
    }
    judged += batch.length;
  }
  return settled();
};

export const jev = definePlugin({
  afterRecall: gate,
  config,
  defaults: {
    config: { matches: true, strictness: "medium" },
    enabled: false,
  },
  description:
    "Uses a small AI model (Jev) to check each related memory against what your AI is looking for, and hides the ones that don’t help. If the check fails, recall fails rather than show unchecked memories. Slows recall and uses Workers AI credits.",
  name: "jev",
  title: "Relevance filter (Jev)",
});
