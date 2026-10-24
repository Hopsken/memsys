import path from "node:path";

import { getPlatformProxy } from "wrangler";
import { z } from "zod";

import type { SlimQuestion } from "./dataset.ts";

const ATTEMPTS = 3;

const answers = z.object({
  answers: z.record(z.string(), z.object({ noul: z.number() })),
});
const output = z.union([
  answers,
  z
    .object({ result: answers.extend({ model: z.string().optional() }) })
    .transform(({ result }) => result),
]);

export interface JevQuestion {
  criteria: { false: string; true: string };
  instructions: string;
  type: "noul";
}

export const jev = async () => {
  const proxy = await getPlatformProxy<{ AI: Ai }>({
    configPath: path.join(import.meta.dirname, "..", "..", "wrangler.jsonc"),
    remoteBindings: true,
  });
  return {
    dispose: () => proxy.dispose(),
    score: async (
      questions: Record<string, JevQuestion>,
      state: Record<string, Record<string, string> | string>
    ) => {
      let lastError = "";
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        try {
          // SAFETY: the binding's model union has no entry for Jev; the
          // output is parsed below.
          // oxlint-disable-next-line no-await-in-loop
          const raw = await proxy.env.AI.run("typesafe/jev" as never, {
            questions,
            state,
          });
          const parsed = output.parse(raw);
          return {
            model: "model" in parsed ? (parsed.model ?? "") : "",
            scores: Object.fromEntries(
              Object.entries(parsed.answers).map(([key, { noul }]) => [
                key,
                noul,
              ])
            ),
          };
        } catch (error) {
          lastError = String(error);
        }
      }
      throw new Error(`Jev: ${lastError}`);
    },
  };
};
export type Jev = Awaited<ReturnType<typeof jev>>;

export const answerCriteria = (q: SlimQuestion): JevQuestion => {
  if (q.abstain) {
    return {
      criteria: {
        false:
          "The response answers as if the asked information were on record, accepting the question's premise.",
        true: "The response says the asked information is not on record or is incomplete. It still counts when the response gives other related information, or states what follows from the gap (such as a count of zero).",
      },
      instructions:
        "Given `question`, which cannot be answered from the record (`answer` explains why), does `response` identify that the asked information is not there?",
      type: "noul",
    };
  }
  const instructions =
    "Given `question` and its correct answer `answer`, is `response` correct?";
  const wrong =
    "The response gives a different answer, no answer, or only part of the information the correct answer requires. Information the response offers as general knowledge while saying it has no record of the answer does not count.";
  switch (q.type) {
    case "single-session-preference": {
      return {
        criteria: {
          false:
            "The response ignores the user's personal information or uses it wrongly.",
          true: "The response satisfies the rubric in `answer`: it recalls and uses the user's personal information correctly. It need not cover every point of the rubric.",
        },
        instructions:
          "Given `question` and a rubric `answer` for a personalized reply, does `response` satisfy it?",
        type: "noul",
      };
    }
    case "temporal-reasoning": {
      return {
        criteria: {
          false: wrong,
          true: "The response contains the correct answer, an equivalent answer, or all the steps to reach it. A count of days, weeks, or months that is off by one still counts as correct.",
        },
        instructions,
        type: "noul",
      };
    }
    case "knowledge-update": {
      return {
        criteria: {
          false: wrong,
          true: "The response gives the updated answer as the current one. Mentioning earlier values as well is fine.",
        },
        instructions,
        type: "noul",
      };
    }
    default: {
      return {
        criteria: {
          false: wrong,
          true: "The response contains the correct answer, an equivalent answer, or all the steps to reach it.",
        },
        instructions,
        type: "noul",
      };
    }
  }
};

export const UNSURE = { high: 0.7, low: 0.3 };
export const CORRECT = 0.5;
