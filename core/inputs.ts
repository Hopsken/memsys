import { z } from "zod";

import type { Author, Fragment, Op } from "@contract/memory";
import { extractAnchors, withinTag } from "@lib/anchor";
import { FRAGMENT_MAX, fragmentLength } from "@lib/fragment";

export const REF_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const REF_LENGTH = 7;
export const PAGE_SIZE = 50;

export const fragment = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0)
  .refine((value) => fragmentLength(value) <= FRAGMENT_MAX, {
    message: `Fragment must contain at most ${FRAGMENT_MAX} characters (Unicode grapheme clusters).`,
  })
  .describe(
    "One atomic text fragment. Keep it short: a few sentences at most. Long fragments may be warned about or rejected."
  );
const ref = z
  .string()
  .length(REF_LENGTH)
  .regex(/^[23456789abcdefghjkmnpqrstuvwxyz]+$/u);

const cursor = z
  .string()
  .max(64)
  .transform((value) => value.split(","))
  .pipe(z.tuple([z.iso.datetime({ precision: 3 }), ref]));

const tag = z
  .string()
  .max(256)
  .regex(/^[\p{L}\p{N}_/-]+$/u)
  .transform((value) => value.toLowerCase());

export const listInput = z
  .object({ cursor: cursor.optional(), tag: z.array(tag).max(10).optional() })
  .strict();

export const activityInput = z.object({ cursor: cursor.optional() }).strict();

export const inputs = {
  forget: z.object({ ref }).strict(),
  remember: z.object({ fragment }).strict(),
  revise: z.object({ fragment, ref }).strict(),
};

const op = z.enum([
  "remember",
  "revise",
  "forget",
  "restore",
] as const satisfies readonly Op[]);

const author = z.union([
  z.literal("user"),
  z.templateLiteral(["agent:", z.string().max(256)]),
]) satisfies z.ZodType<Author>;

export const logRecord = z
  .object({
    at: z.iso
      .datetime({ precision: 3 })
      .transform((value) => Date.parse(value)),
    by: author.optional(),
    fragment: fragment.nullable(),
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

export const importInput = z
  .object({ content: z.string(), format: z.enum(["ndjson", "text"]) })
  .strict();

export const restoreInput = z
  .object({
    at: z.iso
      .datetime({ precision: 3 })
      .transform((value) => Date.parse(value)),
  })
  .strict();

export const listFragments = <T extends Fragment>(
  corpus: Iterable<T>,
  input: z.input<typeof listInput>
) => {
  const { cursor: after, tag: tags = [] } = listInput.parse(input);
  const ordered = [...corpus]
    .filter(
      (item) =>
        !after ||
        item.at < after[0] ||
        (item.at === after[0] && item.ref > after[1])
    )
    .filter((item) => {
      const anchors = extractAnchors(item.fragment);
      return tags.every((each) =>
        anchors.some((anchor) => withinTag(anchor, each))
      );
    })
    .toSorted((a, b) => b.at.localeCompare(a.at) || a.ref.localeCompare(b.ref));
  const fragments = ordered.slice(0, PAGE_SIZE);
  const last = fragments.at(-1);
  return {
    fragments,
    nextCursor:
      ordered.length > PAGE_SIZE && last ? `${last.at},${last.ref}` : null,
  };
};
