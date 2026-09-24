import { stem } from "porter2";
import { z } from "zod";

import { FRAGMENT_MAX, fragmentLength } from "../contract/fragment";
import type {
  Fragment,
  FragmentPage,
  RecallItem,
  RecallResult,
} from "../contract/memory";

// Lowercase only; omit 0, 1, i, l, and o. 31^7 possible refs.
export const REF_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const REF_LENGTH = 7;
const RESULT_LIMIT = 20;
const RESULT_LIMIT_MAX = 50;
const PAGE_SIZE = 50;

const fragment = z
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

export const listInput = z.object({ cursor: cursor.optional() }).strict();

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
      cue: z.string().trim().min(1).max(256),
      limit: z
        .int()
        .min(1)
        .max(RESULT_LIMIT_MAX)
        .optional()
        .describe(
          `Maximum fragments to return, 1–${RESULT_LIMIT_MAX}. Defaults to ${RESULT_LIMIT}.`
        ),
    })
    .strict(),
  remember: z.object({ fragment }).strict(),
  revise: z.object({ fragment, ref }).strict(),
};

export const listFragments = (
  corpus: Iterable<Fragment>,
  input: { cursor?: string }
): FragmentPage => {
  const { cursor: after } = listInput.parse(input);
  const ordered = [...corpus]
    .filter(
      (item) =>
        !after ||
        item.updatedAt < after[0] ||
        (item.updatedAt === after[0] && item.ref > after[1])
    )
    .toSorted(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.ref.localeCompare(b.ref)
    );
  const fragments = ordered.slice(0, PAGE_SIZE);
  const last = fragments.at(-1);
  return {
    fragments,
    nextCursor:
      ordered.length > PAGE_SIZE && last
        ? `${last.updatedAt},${last.ref}`
        : null,
  };
};

const normalize = (text: string): string =>
  text.toLowerCase().replaceAll(/\s+/gu, " ").trim();

export const extractAnchors = (text: string): string[] =>
  [
    ...new Set(
      [
        ...text.matchAll(
          /(?:^|[^\p{L}\p{N}_/#])#(?<anchor>[\p{L}\p{N}_/-]+)/gu
        ),
      ].map((match) => (match.groups?.anchor ?? "").toLowerCase())
    ),
  ].toSorted();

// Keep namespaces exact; stem English words in other anchors independently.
const associationKeys = (anchor: string): string[] =>
  anchor.includes("/")
    ? [anchor]
    : [anchor, ...anchor.split("-").filter(Boolean)].map((word) =>
        /^[a-z]+$/u.test(word) ? stem(word) : word
      );

export const recall = (
  corpus: Iterable<Fragment>,
  input: z.input<typeof inputs.recall>
): RecallResult => {
  const {
    associate = true,
    cue,
    limit = RESULT_LIMIT,
  } = inputs.recall.parse(input);
  const ordered = [...corpus].toSorted(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.ref.localeCompare(b.ref)
  );
  const normalizedCue = normalize(cue);
  const matches: RecallItem[] = ordered.filter((item) =>
    normalize(item.fragment).includes(normalizedCue)
  );
  const refs = new Set(matches.map((item) => item.ref));
  // Only returned matches seed association.
  const keys = new Set(
    associate
      ? matches
          .slice(0, limit)
          .flatMap((item) =>
            extractAnchors(item.fragment).flatMap(associationKeys)
          )
      : []
  );
  const associated = ordered
    .filter((item) => keys.size > 0 && !refs.has(item.ref))
    .map((item) => ({
      ...item,
      via: extractAnchors(item.fragment).filter((anchor) =>
        associationKeys(anchor).some((key) => keys.has(key))
      ),
    }))
    .filter((item) => item.via.length > 0);
  const candidates = [...matches, ...associated];

  return {
    fragments: candidates.slice(0, limit),
    hasMore: candidates.length > limit,
  };
};
