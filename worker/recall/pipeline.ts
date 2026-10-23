import type { z } from "zod";

import type { Fragment, RecallResult } from "../../contract/memory";
import { parseRecall } from "../memory";
import type { inputs } from "../memory";
import { runRecall } from "./host";
import type { Pipeline } from "./host";
import { match } from "./match";
import { output } from "./output";
import { spread } from "./spread";

// Recall, in order.
export const pipeline: Pipeline = [
  { builtin: match },
  { builtin: spread },
  { plugin: "idf" },
  { plugin: "jev" },
  { builtin: output },
];

// Recall with only the built-in stages.
export const recall = async (
  corpus: Iterable<Fragment>,
  raw: z.input<typeof inputs.recall>
): Promise<RecallResult> => {
  const { input, warnings } = parseRecall(raw);
  const env = {
    ai: { run: () => Promise.reject(new Error("No model")) },
    corpus: new Map([...corpus].map((item) => [item.ref, item])),
  };
  const result = await runRecall(pipeline, [], env, input);
  if ("error" in result) {
    throw new Error(result.error);
  }
  return {
    fragments: result.items,
    hasMore: result.truncated,
    ...(warnings.length > 0 && { warnings }),
  };
};
