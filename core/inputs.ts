import { z } from "zod";

import { extractAnchors, withinTag } from "@lib/anchor";

import {
  fragmentTextSchema,
  personaIdSchema,
  personaNameSchema,
  refSchema,
  sourceSchema,
  timestampSchema,
} from "./model";
import type { Fragment, Source } from "./model";

export const PAGE_SIZE = 50;

const listCursorSchema = z
  .string()
  .max(64)
  .transform((value) => value.split(","))
  .pipe(z.tuple([timestampSchema, z.string().regex(/^[1-9]\d*$/u)]))
  .transform(
    ([updatedAt, versionId]) => [updatedAt, Number(versionId)] as const
  );

const activityCursorSchema = z
  .string()
  .max(64)
  .transform((value) => value.split(","))
  .pipe(z.tuple([timestampSchema, z.string().regex(/^[1-9]\d*$/u)]))
  .transform(([createdAt, id]) => [Date.parse(createdAt), Number(id)] as const);

const tagSchema = z
  .string()
  .max(256)
  .regex(/^[\p{L}\p{N}_/-]+$/u)
  .transform((value) => value.toLowerCase());

export const listInputSchema = z
  .object({
    cursor: listCursorSchema.optional(),
    source: sourceSchema.optional(),
    tag: z.array(tagSchema).max(10).optional(),
  })
  .strict();

export const activityInputSchema = z
  .object({
    cursor: activityCursorSchema.optional(),
    source: sourceSchema.optional(),
  })
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

export const restoreInputSchema = z.object({ id: z.int().positive() }).strict();

export const listFragments = <T extends Fragment & { source?: Source | null }>(
  corpus: Iterable<T>,
  input: z.input<typeof listInputSchema>
) => {
  const {
    cursor: after,
    source,
    tag: tags = [],
  } = listInputSchema.parse(input);
  const ordered = [...corpus]
    .filter((item) => !source || item.source === source)
    .filter(
      (item) =>
        !after ||
        item.updatedAt < after[0] ||
        (item.updatedAt === after[0] && item.versionId < after[1])
    )
    .filter((item) => {
      const anchors = extractAnchors(item.fragment);
      return tags.every((each) =>
        anchors.some((anchor) => withinTag(anchor, each))
      );
    })
    .toSorted(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || b.versionId - a.versionId
    );
  const fragments = ordered.slice(0, PAGE_SIZE);
  const last = fragments.at(-1);
  return {
    fragments,
    nextCursor:
      ordered.length > PAGE_SIZE && last
        ? `${last.updatedAt},${last.versionId}`
        : null,
  };
};
