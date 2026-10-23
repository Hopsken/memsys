import { z } from "zod";

import type { Author, Fragment, Op, RecallInput } from "../contract/memory";
import { extractAnchors, withinTag } from "../lib/anchor";
import { FRAGMENT_MAX, fragmentLength } from "../lib/fragment";
import { RECALL_LIMIT_MAX } from "../lib/recall";

// Lowercase only; omit 0, 1, i, l, and o. 31^7 possible refs.
export const REF_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const REF_LENGTH = 7;
const RESULT_LIMIT = 10;
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

// An anchor name without its `#`; the list keeps fragments carrying every tag.
const tag = z
  .string()
  .max(256)
  .regex(/^[\p{L}\p{N}_/-]+$/u)
  .transform((value) => value.toLowerCase());

export const listInput = z
  .object({ cursor: cursor.optional(), tag: z.array(tag).max(10).optional() })
  .strict();

// Activity pages like the list but has no filter.
export const activityInput = z.object({ cursor: cursor.optional() }).strict();

export const inputs = {
  forget: z.object({ ref }).strict(),
  recall: z
    .object({
      associate: z
        .boolean()
        .optional()
        .describe(
          "Also return fragments sharing #anchors with direct matches. Defaults to true."
        ),
      context: z
        .string()
        .max(1000)
        .optional()
        .describe("Optional: what you are doing right now."),
      cue: z
        .string()
        .trim()
        .min(1)
        .max(256)
        .describe(
          "Free text, not a single tag: one or a few words, a phrase, or #anchors. Matches contain every word; a cue of three or more words may miss one."
        ),
      limit: z
        .int()
        .min(1)
        .optional()
        .describe(
          `Maximum fragments to return, at most ${RECALL_LIMIT_MAX}; larger values are capped with a warning. Defaults to ${RESULT_LIMIT}. Raise it when a result has \`hasMore\`.`
        ),
    })
    .strict(),
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

// One log line. Readers drop unknown keys and reject an unknown `v`; `at`
// becomes epoch milliseconds, the storage format. Only a forget clears the
// text.
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

// A user action on one record of the log; not exposed over MCP. The ref
// comes from the path.
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

// Recall input with defaults applied, and why it differs from the request.
export const parseRecall = (raw: z.input<typeof inputs.recall>) => {
  const {
    associate = true,
    context = null,
    cue,
    limit: requested = RESULT_LIMIT,
  } = inputs.recall.parse(raw);
  // A limit past the cap is lowered rather than rejected, and said so.
  const limit = Math.min(requested, RECALL_LIMIT_MAX);
  const warnings =
    requested > limit
      ? [
          `limit ${requested} is above the maximum of ${RECALL_LIMIT_MAX}; returned at most ${RECALL_LIMIT_MAX} fragments.`,
        ]
      : [];
  const input: RecallInput = { associate, context, cue, limit };
  return { input, warnings };
};
