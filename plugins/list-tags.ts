import { z } from "zod";

import { definePlugin } from "../contract/plugin";

export const listTags = definePlugin({
  config: z.object({}),
  defaults: { config: {}, enabled: true },
  description:
    "Lets your AI see the #tags you already use, so it reuses them instead of inventing near-duplicates.",
  name: "list-tags",
  title: "Tag list",
  tools: [
    {
      annotations: { readOnlyHint: true },
      description: "List all #anchor names currently used.",
      input: z.object({}).strict(),
      name: "list_tags",
      run: (ctx) =>
        Promise.resolve(
          [
            ...new Set(
              [...ctx.corpus.keys()].flatMap((ref) => ctx.index.anchors(ref))
            ),
          ].toSorted()
        ),
    },
  ],
});
