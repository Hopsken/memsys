import { z } from "zod";

import { FRAGMENT_MAX, fragmentLength } from "../contract/fragment";
import { definePlugin } from "../contract/plugin";
import type { Verdict } from "../contract/plugin";

const limit = z.int().min(1).max(FRAGMENT_MAX);

const config = z
  .object({
    hard: limit.meta({
      description: "Longer fragments are rejected.",
      title: "Hard limit",
    }),
    soft: limit.meta({
      description: "Longer fragments are stored with a warning.",
      title: "Soft limit",
    }),
  })
  .refine((value) => value.soft <= value.hard, {
    message: "Soft limit must not exceed the hard limit.",
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
  description: "Warns on long fragments and rejects oversized ones.",
  name: "size-limit",
  title: "Fragment size limit",
});
