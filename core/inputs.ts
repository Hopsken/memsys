import { z } from "zod";

import { extractAnchors, withinTag } from "@lib/anchor";

import { fragmentText, ref } from "./model";
import type { Fragment } from "./model";

export const PAGE_SIZE = 50;

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
  remember: z.object({ fragment: fragmentText }).strict(),
  revise: z.object({ fragment: fragmentText, ref }).strict(),
};

export const importInput = z
  .object({ content: z.string(), format: z.enum(["ndjson", "text"]) })
  .strict();

export const restoreInput = z
  .object({ at: z.iso.datetime({ precision: 3 }) })
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
