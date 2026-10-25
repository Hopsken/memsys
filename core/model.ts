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

export const PERSONA_ID_LENGTH = 10;

export const personaIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[23456789abcdefghjkmnpqrstuvwxyz]+$/u);

export const personaNameSchema = z.string().trim().min(1).max(64);

export const authorSchema = z.union([
  z.literal("user"),
  z.templateLiteral(["agent:", z.string().max(256)]),
  z.templateLiteral(["persona:", personaIdSchema]),
]);

export const personaSchema = z.object({
  archivedAt: atSchema.nullable(),
  createdAt: atSchema,
  id: personaIdSchema,
  name: personaNameSchema,
});

export const personaRecordSchema = z
  .object({
    archivedAt: atSchema.optional(),
    createdAt: atSchema,
    name: personaNameSchema,
    persona: personaIdSchema,
    v: z.literal(1),
  })
  .strict();

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
export type Persona = z.infer<typeof personaSchema>;
export type PersonaRecord = z.infer<typeof personaRecordSchema>;
export type Fragment = z.infer<typeof fragmentSchema>;
export type Version = z.infer<typeof versionSchema>;
export type LogRecord = z.input<typeof logRecordSchema>;
