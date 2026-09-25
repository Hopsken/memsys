import { z } from "zod";

import type { RecallInput, RecallItem } from "../contract/memory";
import { definePlugin } from "../contract/plugin";
import type { Ctx, Json } from "../contract/plugin";
import { RECALL_LIMIT_MAX } from "../lib/recall";

// Relevance gate per RFC 1 Stage 2: one independent noul per candidate, so
// "nothing is relevant" is a possible answer. Fail-open: any error, timeout,
// or malformed response leaves the input unchanged via the plugin host.
export const JEV_MODEL = "typesafe/jev";
export const JEV_TIMEOUT_MS = 1500;

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

const gate = async (
  { ai, config: { matches, strictness } }: Ctx<Config>,
  items: readonly RecallItem[],
  { context, cue }: RecallInput
) => {
  const gated = (item: RecallItem) => matches || Boolean(item.via);
  // The cap equals recall's max `limit`: past it, items are dropped rather
  // than passed through unjudged to fill the page.
  const judged = items.filter(gated).slice(0, RECALL_LIMIT_MAX);
  const refs = new Set(judged.map((item) => item.ref));
  if (judged.length === 0) {
    return [...items];
  }
  const output = await withTimeout(
    ai.run(JEV_MODEL, {
      questions: Object.fromEntries(
        judged.map((item) => [item.ref, question(item.ref)])
      ),
      state: {
        candidates: Object.fromEntries(
          judged.map((item) => [item.ref, item.fragment])
        ),
        context: context ?? "",
        cue,
      },
    }),
    JEV_TIMEOUT_MS
  );
  const scores = parseScores(output);
  const threshold = STRICTNESS[strictness];
  // Ungated items stay; judged items the model left unanswered stay too.
  return items.filter(
    (item) =>
      !gated(item) ||
      (refs.has(item.ref) && (scores[item.ref]?.noul ?? 1) >= threshold)
  );
};

export const jev = definePlugin({
  afterRecall: gate,
  config,
  defaults: {
    config: { matches: true, strictness: "medium" },
    enabled: false,
  },
  description:
    "Uses a small AI model (Jev) to check each related memory against what your AI is looking for, and hides the ones that don’t help. Adds up to a second per recall and uses Workers AI credits.",
  name: "jev",
  title: "Relevance filter (Jev)",
});
