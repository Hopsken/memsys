import { z } from "zod";

import { FRAGMENT_MAX, fragmentLength } from "@lib/fragment";

export const REF_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const REF_LENGTH = 7;

export const refSchema = z
  .string()
  .length(REF_LENGTH)
  .regex(/^[23456789abcdefghjkmnpqrstuvwxyz]+$/u);

export const fragmentTextSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0)
  .refine((value) => fragmentLength(value) <= FRAGMENT_MAX, {
    message: `Fragment must contain at most ${FRAGMENT_MAX} characters (Unicode grapheme clusters).`,
  })
  .describe(
    "One atomic text fragment. Keep it short: a few sentences at most. Long fragments may be warned about or rejected."
  );

const atSchema = z.iso.datetime({ precision: 3 });

export const opSchema = z.enum(["remember", "revise", "forget", "restore"]);

export const authorSchema = z.union([
  z.literal("user"),
  z.templateLiteral(["agent:", z.string().max(256)]),
]);

export const fragmentSchema = z.object({
  at: atSchema,
  fragment: fragmentTextSchema,
  ref: refSchema,
});

export const versionSchema = z.object({
  at: atSchema,
  by: authorSchema.nullable(),
  fragment: fragmentTextSchema.nullable(),
  op: opSchema,
  ref: refSchema,
});

export const logRecordSchema = z
  .object({
    at: atSchema.transform((value) => Date.parse(value)),
    by: authorSchema.optional(),
    fragment: fragmentTextSchema.nullable(),
    op: opSchema.optional(),
    ref: refSchema,
    v: z.literal(1),
  })
  .refine(
    (record) =>
      record.op === undefined ||
      (record.op === "forget") === (record.fragment === null),
    { message: "Only a forget has no fragment", path: ["op"] }
  );

export type Op = z.infer<typeof opSchema>;
export type Author = z.infer<typeof authorSchema>;
export type Fragment = z.infer<typeof fragmentSchema>;
export type Version = z.infer<typeof versionSchema>;
export type LogRecord = z.input<typeof logRecordSchema>;
