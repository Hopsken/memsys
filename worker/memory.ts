import { stem } from "porter2";
import { z } from "zod";

// Lowercase only; omit 0, 1, i, l, and o. 31^7 possible refs.
export const REF_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const REF_LENGTH = 7;
export const RESULT_LIMIT = 20;
export const PAGE_SIZE = 50;

const FRAGMENT_SOFT_LIMIT = 140;
const FRAGMENT_HARD_LIMIT = 280;
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
const fragmentLength = (value: string) => [...segmenter.segment(value)].length;

const fragment = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0)
  .refine((value) => fragmentLength(value) <= FRAGMENT_HARD_LIMIT, {
    message: `Fragment must contain at most ${FRAGMENT_HARD_LIMIT} characters (Unicode grapheme clusters).`,
  })
  .describe(
    "One atomic text fragment. Prefer at most 140 characters; 141–280 returns a warning; over 280 is rejected. Count Unicode grapheme clusters, including whitespace and #anchors."
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

export const listInput = z
  .object({ archived: z.stringbool().optional(), cursor: cursor.optional() })
  .strict();

export const refInput = z.object({ ref }).strict();
export const restReviseInput = z.object({ fragment, ref }).strict();
export const restoreInput = z
  .object({ ref, version: z.int().positive().optional() })
  .strict();

export const inputs = {
  forget: refInput,
  recall: z.object({ cue: z.string().trim().min(1).max(256) }).strict(),
  remember: z.object({ fragment }).strict(),
  revise: z
    .object({
      new_string: z.string(),
      old_string: z.string().min(1),
      ref,
      replaceAll: z.boolean().optional(),
    })
    .strict(),
};

// The latest revision of a ref, retaining the fragment's original createdAt.
// For an archived fragment, updatedAt is the archive time.
export interface Fragment {
  ref: string;
  fragment: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Revision {
  version: number;
  fragment: string;
  archived: boolean;
  createdAt: string;
}

export const fragmentWriteResult = (item: Fragment) => {
  const length = fragmentLength(item.fragment);
  const result: Fragment & { warnings?: string[] } = { ...item };
  if (length > FRAGMENT_SOFT_LIMIT) {
    result.warnings = [
      `Fragment contains ${length} characters, above the recommended ${FRAGMENT_SOFT_LIMIT}. Consider splitting it into smaller fragments.`,
    ];
  }
  return result;
};

// The caller picks the corpus (active or archived); this only pages it.
export const listFragments = (
  corpus: Iterable<Fragment>,
  input: z.input<typeof listInput>
) => {
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

export type FragmentPage = ReturnType<typeof listFragments>;

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

export const recall = (corpus: Iterable<Fragment>, cue: string) => {
  const ordered = [...corpus].toSorted(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.ref.localeCompare(b.ref)
  );
  const normalizedCue = normalize(cue);
  const matches = ordered.filter((item) =>
    normalize(item.fragment).includes(normalizedCue)
  );
  const recalled = matches.slice(0, RESULT_LIMIT).map((item) => ({
    ...item,
    anchors: extractAnchors(item.fragment),
  }));
  const refs = new Set(matches.map((item) => item.ref));
  const anchors = new Set(
    recalled.flatMap((item) => item.anchors.flatMap(associationKeys))
  );
  const associated = ordered
    .filter((item) => !refs.has(item.ref))
    .map((item) => ({
      ...item,
      sharedAnchors: extractAnchors(item.fragment).filter((anchor) =>
        associationKeys(anchor).some((key) => anchors.has(key))
      ),
    }))
    .filter((item) => item.sharedAnchors.length > 0);

  return {
    associated: associated.slice(0, RESULT_LIMIT),
    hasMoreAssociated: associated.length > RESULT_LIMIT,
    hasMoreRecalled: matches.length > RESULT_LIMIT,
    recalled,
  };
};
