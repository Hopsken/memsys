import { z } from "zod";

import type {
  Author,
  Fragment,
  Op,
  RecallInput,
  RecallItem,
  RecallResult,
} from "../contract/memory";
import { associationKeys, extractAnchors, withinTag } from "../lib/anchor";
import { FRAGMENT_MAX, fragmentLength } from "../lib/fragment";
import { RECALL_MAX } from "../lib/recall";
import { bm25, terms } from "./search";

// Lowercase only; omit 0, 1, i, l, and o. 31^7 possible refs.
export const REF_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const REF_LENGTH = 7;
export const PAGE_SIZE = 50;
// Recall ceilings (RFC 0002). Direct matches past MATCH_MAX are cut and set
// `hasMore`. Associations past the per-key and total ceilings are forgotten,
// oldest first, and do not.
export const MATCH_MAX = 200;
export const KEY_ASSOCIATION_MAX = 20;
export const ASSOCIATION_MAX = 200;

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

const normalize = (text: string): string =>
  text.toLowerCase().replaceAll(/\s+/gu, " ").trim();

// Candidate generation: cue matches (best first), then one-hop associations.
export const recallCandidates = (
  corpus: Iterable<Fragment>,
  raw: z.input<typeof inputs.recall>
) => {
  const { associate = true, context = null, cue } = inputs.recall.parse(raw);
  const input: RecallInput = { associate, context, cue };
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
  const kept = matches.slice(0, MATCH_MAX);
  // Every kept match seeds association.
  const keys = new Set(
    associate
      ? kept.flatMap((item) =>
          extractAnchors(item.fragment).flatMap(associationKeys)
        )
      : []
  );
  // Newest first, each shared key brings at most KEY_ASSOCIATION_MAX: a busy
  // anchor forgets its oldest fragments while a rare one keeps them all.
  const brought = new Map<string, number>();
  const associated = ordered
    .filter((item) => keys.size > 0 && !refs.has(item.ref))
    .map((item) => ({
      ...item,
      via: extractAnchors(item.fragment).filter((anchor) =>
        associationKeys(anchor).some((key) => keys.has(key))
      ),
    }))
    .filter(({ via }) => {
      const shared = [
        ...new Set(via.flatMap(associationKeys).filter((key) => keys.has(key))),
      ];
      if (
        shared.every((key) => (brought.get(key) ?? 0) >= KEY_ASSOCIATION_MAX)
      ) {
        return false;
      }
      for (const key of shared) {
        brought.set(key, (brought.get(key) ?? 0) + 1);
      }
      return true;
    })
    .slice(0, ASSOCIATION_MAX);
  const candidates: RecallItem[] = [...kept, ...associated];
  return { candidates, cut: matches.length > MATCH_MAX, input };
};

// Terminal truncation. Plugins saw every candidate. `hasMore` is set by what
// a more specific cue would reach: cut matches, or survivors past RECALL_MAX.
export const truncate = (
  ranked: readonly RecallItem[],
  cut: boolean
): RecallResult => ({
  fragments: ranked.slice(0, RECALL_MAX),
  hasMore: cut || ranked.length > RECALL_MAX,
});

// Core recall without plugins.
export const recall = (
  corpus: Iterable<Fragment>,
  raw: z.input<typeof inputs.recall>
): RecallResult => {
  const { candidates, cut } = recallCandidates(corpus, raw);
  return truncate(candidates, cut);
};
