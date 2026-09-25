import { z } from "zod";

import { definePlugin } from "../contract/plugin";
import type { Verdict } from "../contract/plugin";
import { FRAGMENT_MAX, fragmentLength } from "../lib/fragment";

const limit = z.int().min(1).max(FRAGMENT_MAX);

const config = z
  .object({
    hard: limit.meta({
      description: "Longer memories are refused. Counted in characters.",
      title: "Refuse above",
    }),
    soft: limit.meta({
      description: "Longer memories are saved, with a nudge to split them.",
      title: "Warn above",
    }),
  })
  .refine((value) => value.soft <= value.hard, {
    message: "Can’t be higher than Refuse above.",
    path: ["soft"],
  });

const check = (
  { hard, soft }: z.infer<typeof config>,
  text: string
): Verdict => {
  const length = fragmentLength(text);
  if (length > hard) {
    return {
      rejections: [
        `Fragment contains ${length} characters, above the limit of ${hard}. Split it into smaller fragments.`,
      ],
      warnings: [],
    };
  }
  if (length > soft) {
    return {
      rejections: [],
      warnings: [
        `Fragment contains ${length} characters, above the recommended ${soft}. Consider splitting it into smaller fragments.`,
      ],
    };
  }
  return { rejections: [], warnings: [] };
};

export const sizeLimit = definePlugin({
  beforeRemember: (ctx, text) => Promise.resolve(check(ctx.config, text)),
  beforeRevise: (ctx, _prev, text) => Promise.resolve(check(ctx.config, text)),
  config,
  defaults: { config: { hard: 500, soft: 300 }, enabled: true },
  description:
    "Keeps each memory to one short idea. Long ones get a warning; very long ones are refused.",
  name: "size-limit",
  title: "Short memories",
});
