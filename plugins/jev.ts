import { z } from "zod";

import type { RecallInput, RecallItem } from "../contract/memory";
import { definePlugin } from "../contract/plugin";
import type { Ctx } from "../contract/plugin";

// Relevance gate per RFC 1 Stage 2: one independent noul per candidate, so
// "nothing is relevant" is a possible answer. Fail-open: any error, timeout,
// or malformed response leaves the input unchanged via the plugin host.
export const JEV_MODEL = "typesafe/jev";
export const JEV_TIMEOUT_MS = 1500;
export const JEV_MAX_CANDIDATES = 40;

const config = z.object({
  matches: z.boolean().meta({
    description:
      "Also judge fragments that contain the cue. Off judges associations only.",
    title: "Gate cue matches",
  }),
  threshold: z.number().min(0).max(1).meta({
    description: "Fragments judged less likely than this to help are dropped.",
    title: "Threshold",
  }),
});

type Config = z.infer<typeof config>;

const answers = z.object({
  answers: z.record(z.string(), z.object({ noul: z.number().min(0).max(1) })),
});

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
  { ai, config: { matches, threshold } }: Ctx<Config>,
  items: readonly RecallItem[],
  { context, cue }: RecallInput
) => {
  const judged = items
    .filter((item) => matches || item.via)
    .slice(0, JEV_MAX_CANDIDATES);
  if (judged.length === 0) {
    return [...items];
  }
  const response = await withTimeout(
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
  const scores = answers.parse(response).answers;
  // Unanswered or unjudged items stay; only a confident "no" drops one.
  return items.filter((item) => (scores[item.ref]?.noul ?? 1) >= threshold);
};

export const jev = definePlugin({
  afterRecall: gate,
  config,
  defaults: { config: { matches: false, threshold: 0.5 }, enabled: false },
  description:
    "Asks Jev whether each recalled fragment helps with the cue and context, and drops the ones it rules out.",
  name: "jev",
  title: "Relevance gate (Jev)",
});
