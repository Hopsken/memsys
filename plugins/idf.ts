import { z } from "zod";

import type { RecallItem } from "../contract/memory";
import { definePlugin } from "../contract/plugin";
import type { Ctx } from "../contract/plugin";

// ln((N+1)/(df+1)): high for rare anchors, near zero for hubs.
const weights = ({ corpus, index }: Ctx<unknown>) => {
  const df = new Map<string, number>();
  for (const ref of corpus.keys()) {
    for (const anchor of index.anchors(ref)) {
      df.set(anchor, (df.get(anchor) ?? 0) + 1);
    }
  }
  return (anchor: string) =>
    Math.log((corpus.size + 1) / ((df.get(anchor) ?? 0) + 1));
};

const rank = (ctx: Ctx<unknown>, items: readonly RecallItem[]) => {
  const weight = weights(ctx);
  const score = new Map(
    items.map((item) => [
      item.ref,
      (item.via ?? []).reduce((sum, anchor) => sum + weight(anchor), 0),
    ])
  );
  // Cue matches keep their place; stable sort keeps recency among ties.
  return [
    ...items.filter((item) => !item.via),
    ...items
      .filter((item) => item.via)
      .toSorted((a, b) => (score.get(b.ref) ?? 0) - (score.get(a.ref) ?? 0)),
  ];
};

export const idf = definePlugin({
  afterRecall: (ctx, items) => Promise.resolve(rank(ctx, items)),
  config: z.object({}),
  defaults: { config: {}, enabled: true },
  description:
    "When recalling, related memories that share a rare #tag come first; ones linked only by a common tag like #work sink.",
  name: "idf",
  title: "Prioritize specific links",
});
