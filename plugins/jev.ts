import { z } from "zod";

import type { RecallInput, RecallItem } from "../contract/memory";
import { definePlugin, PluginAbortError } from "../contract/plugin";
import type { Ctx, Json } from "../contract/plugin";

// Relevance gate: one independent noul per candidate, so "nothing is relevant"
// is a possible answer. It never passes on a candidate it did not judge: if
// it cannot judge, the recall fails (RFC 0002, decision 5).
export const JEV_MODEL = "typesafe/jev";
export const JEV_TIMEOUT_MS = 1500;
// Tries per recall; each retry asks only about candidates still unanswered.
export const JEV_ATTEMPTS = 3;
// Judges at most this many candidates per recall.
export const JEV_BUDGET = 40;

// Workers AI codes that retrying cannot fix: no balance, a model that is gone,
// or an account or plan that may not use it.
const PERSISTENT = new Set([3023, 3036, 3041, 3042, 5007, 5016, 5018, 5035]);

// The binding throws `AiError: 3036: …`; some versions also set `code`.
const AI_ERROR_CODE = /(?:^|\s)(?<code>\d{4}):/u;

// Named levels instead of a raw probability: 0.45 vs 0.48 means nothing to a
// user. Measured on real recalls, misses score ≲0.15 and hits ≳0.9.
export const STRICTNESS = { high: 0.5, low: 0.1, max: 0.7, medium: 0.3 };

// Rows saved with the earlier `matches` switch still parse: zod strips it.
const config = z.object({
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

const ask = async (
  ai: Ctx<Config>["ai"],
  candidates: readonly RecallItem[],
  { context, cue }: RecallInput
) => {
  const output = await withTimeout(
    ai.run(JEV_MODEL, {
      questions: Object.fromEntries(
        candidates.map((item) => [item.ref, question(item.ref)])
      ),
      state: {
        candidates: Object.fromEntries(
          candidates.map((item) => [item.ref, item.fragment])
        ),
        context: context ?? "",
        cue,
      },
    }),
    JEV_TIMEOUT_MS
  );
  return parseScores(output);
};

// A score for every candidate, or a PluginAbortError that says whether a
// retry can help.
const judge = async (
  ai: Ctx<Config>["ai"],
  candidates: readonly RecallItem[],
  input: RecallInput
) => {
  const scores = new Map<string, number>();
  let failure = "";
  for (let attempt = 1; attempt <= JEV_ATTEMPTS; attempt += 1) {
    const pending = candidates.filter((item) => !scores.has(item.ref));
    try {
      // Sequential by design: a retry asks only what is still unanswered.
      // oxlint-disable-next-line no-await-in-loop
      const reply = await ask(ai, pending, input);
      for (const { ref } of pending) {
        const noul = reply[ref]?.noul;
        if (noul !== undefined) {
          scores.set(ref, noul);
        }
      }
      const unanswered = pending.filter((item) => !scores.has(item.ref));
      if (unanswered.length === 0) {
        break;
      }
      failure = `left ${unanswered.length} memories unanswered`;
    } catch (error) {
      const code =
        z.object({ code: z.number() }).safeParse(error).data?.code ??
        Number(AI_ERROR_CODE.exec(String(error))?.groups?.["code"]);
      if (PERSISTENT.has(code)) {
        throw new PluginAbortError(
          `Relevance check is unavailable (${String(error)}). Retrying will not help: the memory owner must fix Workers AI or turn off the relevance filter.`
        );
      }
      failure = String(error);
    }
    console.error({ attempt, error: failure, event: "jev.attempt.failed" });
  }
  if (scores.size < candidates.length) {
    throw new PluginAbortError(
      `Relevance check failed (${failure}). Retry this recall shortly.`
    );
  }
  return scores;
};

const gate = async (
  { ai, config: { strictness } }: Ctx<Config>,
  items: readonly RecallItem[],
  input: RecallInput
) => {
  // Cuts to its budget first; only a dropped cue match is a cut a better cue
  // would recover.
  const judged = items.slice(0, JEV_BUDGET);
  const truncated = items.slice(JEV_BUDGET).some((item) => !item.via);
  if (judged.length === 0) {
    return { items: [] };
  }
  const scores = await judge(ai, judged, input);
  const threshold = STRICTNESS[strictness];
  return {
    items: judged.filter((item) => (scores.get(item.ref) ?? 0) >= threshold),
    truncated,
  };
};

export const jev = definePlugin({
  config,
  defaults: {
    config: { strictness: "medium" },
    enabled: false,
  },
  description:
    "Uses a small AI model (Jev) to check each memory against what your AI is looking for, and hides the ones that don’t help. Adds about a second per recall and uses Workers AI credits. If the check fails, the recall fails too.",
  name: "jev",
  recall: gate,
  title: "Relevance filter (Jev)",
});
