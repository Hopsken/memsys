import { z } from "zod";

import { extractAnchors, withinTag } from "@lib/anchor";

import {
  authorSchema,
  fragmentTextSchema,
  personaIdSchema,
  personaNameSchema,
  refSchema,
} from "./model";
import type { Fragment } from "./model";

export const PAGE_SIZE = 50;

const cursorSchema = z
  .string()
  .max(64)
  .transform((value) => value.split(","))
  .pipe(z.tuple([z.iso.datetime({ precision: 3 }), refSchema]));

const tagSchema = z
  .string()
  .max(256)
  .regex(/^[\p{L}\p{N}_/-]+$/u)
  .transform((value) => value.toLowerCase());

export const listInputSchema = z
  .object({
    cursor: cursorSchema.optional(),
    tag: z.array(tagSchema).max(10).optional(),
  })
  .strict();

export const activityInputSchema = z
  .object({ by: authorSchema.optional(), cursor: cursorSchema.optional() })
  .strict();

export const inputSchemas = {
  forget: z.object({ ref: refSchema }).strict(),
  remember: z.object({ fragment: fragmentTextSchema }).strict(),
  revise: z.object({ fragment: fragmentTextSchema, ref: refSchema }).strict(),
};

export const personaInputSchemas = {
  archive: z.object({ archived: z.boolean(), id: personaIdSchema }).strict(),
  create: z.object({ name: personaNameSchema }).strict(),
  rename: z.object({ id: personaIdSchema, name: personaNameSchema }).strict(),
};

export const importInputSchema = z
  .object({ content: z.string(), format: z.enum(["ndjson", "text"]) })
  .strict();

export const restoreInputSchema = z
  .object({ at: z.iso.datetime({ precision: 3 }) })
  .strict();

export const listFragments = <T extends Fragment>(
  corpus: Iterable<T>,
  input: z.input<typeof listInputSchema>
) => {
  const { cursor: after, tag: tags = [] } = listInputSchema.parse(input);
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
