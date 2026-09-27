import { stem } from "porter2";
import { z } from "zod";

import type {
  Fragment,
  RecallInput,
  RecallItem,
  RecallResult,
} from "../contract/memory";
import { extractAnchors, withinTag } from "../lib/anchor";
import { FRAGMENT_MAX, fragmentLength } from "../lib/fragment";
import { RECALL_LIMIT_MAX } from "../lib/recall";
import { bm25, terms } from "./search";

// Lowercase only; omit 0, 1, i, l, and o. 31^7 possible refs.
export const REF_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const REF_LENGTH = 7;
const RESULT_LIMIT = 10;
const PAGE_SIZE = 50;

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

// One log line. Readers drop unknown keys and reject an unknown `v`; `at`
// becomes epoch milliseconds, the storage format.
export const logRecord = z.object({
  at: z.iso.datetime({ precision: 3 }).transform((value) => Date.parse(value)),
  fragment: fragment.nullable(),
  ref,
  v: z.literal(1),
});

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

const normalize = (text: string): string =>
  text.toLowerCase().replaceAll(/\s+/gu, " ").trim();

// Keep namespaces exact; stem English words in other anchors independently.
const associationKeys = (anchor: string): string[] =>
  anchor.includes("/")
    ? [anchor]
    : [anchor, ...anchor.split("-").filter(Boolean)].map((word) =>
        /^[a-z]+$/u.test(word) ? stem(word) : word
      );

// Candidate generation: cue matches (best first), then one-hop associations.
export const recallCandidates = (
  corpus: Iterable<Fragment>,
  raw: z.input<typeof inputs.recall>
) => {
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
  const ordered = [...corpus].toSorted(
    (a, b) => b.at.localeCompare(a.at) || a.ref.localeCompare(b.ref)
  );
  const normalizedCue = normalize(cue);
  const cueTerms = [...new Set(terms(cue))];
  // Every cue term must appear; a cue of three or more terms may miss one.
  const required = cueTerms.length >= 3 ? cueTerms.length - 1 : cueTerms.length;
  const scored = new Map(
    bm25(ordered, cueTerms).map((entry) => [entry.item.ref, entry])
  );
  // Phrase matches first, then by terms matched and BM25; ties stay newest first.
  const matches: RecallItem[] = ordered
    .map((item) => ({
      item,
      matched: scored.get(item.ref)?.matched ?? 0,
      phrase: normalize(item.fragment).includes(normalizedCue),
      score: scored.get(item.ref)?.score ?? 0,
    }))
    .filter(
      ({ matched, phrase }) =>
        phrase || (cueTerms.length > 0 && matched >= required)
    )
    .toSorted(
      (a, b) =>
        Number(b.phrase) - Number(a.phrase) ||
        b.matched - a.matched ||
        b.score - a.score
    )
    .map(({ item }) => item);
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
  const candidates: RecallItem[] = [...matches, ...associated];
  return { candidates, input, warnings };
};

// Terminal truncation. Plugins saw every candidate, so `hasMore` counts what
// survived them.
export const truncate = (
  ranked: readonly RecallItem[],
  limit: number,
  warnings: string[] = []
): RecallResult => ({
  fragments: ranked.slice(0, limit),
  hasMore: ranked.length > limit,
  ...(warnings.length > 0 && { warnings }),
});

// Core recall without plugins.
export const recall = (
  corpus: Iterable<Fragment>,
  raw: z.input<typeof inputs.recall>
): RecallResult => {
  const { candidates, input, warnings } = recallCandidates(corpus, raw);
  return truncate(candidates, input.limit, warnings);
};
