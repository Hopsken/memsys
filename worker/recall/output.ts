import type { RecallStage } from "../../contract/plugin";

const RESULT_SIZE = 10;

// Built-in stage: the final cut to the result size. Only a dropped cue match
// counts as truncated: a dropped association comes back through its own cue
// or anchor, not through a better cue.
export const output: RecallStage<null> = (_ctx, items) =>
  Promise.resolve({
    items: items.slice(0, RESULT_SIZE),
    truncated: items.slice(RESULT_SIZE).some((item) => !item.via),
  });
