import type { RecallStage } from "../../contract/plugin";

// Built-in stage: the final cut to the result size.
export const output: RecallStage<unknown> = (_ctx, items, { limit }) =>
  Promise.resolve({
    items: items.slice(0, limit),
    truncated: items.length > limit,
  });
