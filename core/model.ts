import { z } from "zod";

import { FRAGMENT_MAX, fragmentLength } from "@lib/fragment";

export const REF_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const REF_LENGTH = 7;

export const ref = z
  .string()
  .length(REF_LENGTH)
  .regex(/^[23456789abcdefghjkmnpqrstuvwxyz]+$/u);

export const fragmentText = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0)
  .refine((value) => fragmentLength(value) <= FRAGMENT_MAX, {
    message: `Fragment must contain at most ${FRAGMENT_MAX} characters (Unicode grapheme clusters).`,
  })
  .describe(
    "One atomic text fragment. Keep it short: a few sentences at most. Long fragments may be warned about or rejected."
  );

const at = z.iso.datetime({ precision: 3 });

export const op = z.enum(["remember", "revise", "forget", "restore"]);

export const author = z.union([
  z.literal("user"),
  z.templateLiteral(["agent:", z.string().max(256)]),
]);

export const fragment = z.object({ at, fragment: fragmentText, ref });

export const version = z.object({
  at,
  by: author.nullable(),
  fragment: fragmentText.nullable(),
  op,
  ref,
});

export const logRecord = z
  .object({
    at: at.transform((value) => Date.parse(value)),
    by: author.optional(),
    fragment: fragmentText.nullable(),
    op: op.optional(),
    ref,
    v: z.literal(1),
  })
  .refine(
    (record) =>
      record.op === undefined ||
      (record.op === "forget") === (record.fragment === null),
    { message: "Only a forget has no fragment", path: ["op"] }
  );

export type Op = z.infer<typeof op>;
export type Author = z.infer<typeof author>;
export type Fragment = z.infer<typeof fragment>;
export type Version = z.infer<typeof version>;
export type LogRecord = z.input<typeof logRecord>;
