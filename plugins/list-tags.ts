import { z } from "zod";

import { definePlugin } from "../contract/plugin";

export const listTags = definePlugin({
  config: z.object({}),
  defaults: { config: {}, enabled: true },
  description: "Adds the list_tags tool so agents can reuse existing #anchors.",
  name: "list-tags",
  title: "List tags",
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
