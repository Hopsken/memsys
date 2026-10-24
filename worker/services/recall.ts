import { z } from "zod";

import type {
  Fragment,
  RecallInput,
  RecallItem,
  RecallResult,
} from "../../contract/memory";
import { err, ok } from "../../contract/result";
import type { Result } from "../../contract/result";
import type { Strictness } from "../../contract/settings";
import type { Memory } from "../../core";
import { terms } from "../../lib/analyzer";
import { associationKeys, extractAnchors } from "../../lib/anchor";
import type { RelevanceUnavailable } from "../errors";
import { readSettings } from "./settings";

// Recall policy over the core: which search hits match the cue, which
// associations to keep and in what order, the relevance filter, and the cut.

// What the agent sends to recall. The descriptions are what it reads.
export const recallInput = z
  .object({
    context: z
      .string()
      .max(1000)
      .optional()
      .describe(
        "What you are working on right now. Give it whenever you have a task: it helps pick the memories that matter for it."
      ),
    cue: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .describe(
        "What you need, as a few distinctive words, a phrase, or #anchors. Matches contain every word; a cue of three or more words may miss one. Fragments sharing an #anchor with a match come too. Too few results: use fewer or other words, or an #anchor. `truncated`: add a distinctive word."
      ),
  })
  .strict();

const RESULT_SIZE = 10;
// Cue matches whose anchors seed association.
const SEEDS = 10;
// A hub anchor can link most of the corpus; later steps need far fewer.
const ASSOCIATED = 100;
// The relevance filter judges at most this many candidates per recall.
export const JUDGE_BUDGET = 40;

// Named levels instead of a raw probability: 0.45 vs 0.48 means nothing to a
// user. Measured on real recalls, misses score ≲0.15 and hits ≳0.9.
const STRICTNESS = {
  high: 0.5,
  low: 0.1,
  max: 0.7,
  medium: 0.3,
} satisfies Record<Strictness, number>;

const normalize = (text: string): string =>
  text.toLowerCase().replaceAll(/\s+/gu, " ").trim();

// The distinct search terms of a cue.
const cueTerms = (cue: string) => [...new Set(terms(cue))];

// Hits that match the cue: every term, or all but one for a cue of three or
// more. Fragments containing the whole cue come first, then by terms matched
// and score; ties keep the search's order.
const selectMatches = (
  cue: string,
  query: readonly string[],
  hits: readonly { fragment: Fragment; matched: string[]; score: number }[]
): Fragment[] => {
  const required = query.length >= 3 ? query.length - 1 : query.length;
  const phrase = normalize(cue);
  return hits
    .map((hit) => ({
      ...hit,
      phrase: normalize(hit.fragment.fragment).includes(phrase),
    }))
    .filter((hit) => hit.phrase || hit.matched.length >= required)
    .toSorted(
      (a, b) =>
        Number(b.phrase) - Number(a.phrase) ||
        b.matched.length - a.matched.length ||
        b.score - a.score
    )
    .map((hit) => hit.fragment);
};

// The association keys of the first matches' anchors.
const seedKeys = (matches: readonly Fragment[]) => [
  ...new Set(
    matches
      .slice(0, SEEDS)
      .flatMap((item) => extractAnchors(item.fragment).flatMap(associationKeys))
  ),
];

// Associations that share a rare #tag come first; ones linked only by a hub
// like #work sink. Each anchor weighs ln((N+1)/(df+1)). Matches are left out,
// and at most ASSOCIATED are kept, newest first, before ranking. The cut is
// not reported: no better cue brings those fragments back through spreading
// (RFC 0002, decision 6).
const rankAssociations = (
  found: readonly { fragment: Fragment; via: string[] }[],
  matches: readonly Fragment[],
  anchors: readonly { anchor: string; fragments: number }[],
  corpusSize: number
): RecallItem[] => {
  const matched = new Set(matches.map((item) => item.ref));
  const df = new Map(anchors.map((item) => [item.anchor, item.fragments]));
  const weight = (anchor: string) =>
    Math.log((corpusSize + 1) / ((df.get(anchor) ?? 0) + 1));
  return found
    .filter((item) => !matched.has(item.fragment.ref))
    .slice(0, ASSOCIATED)
    .map(({ fragment, via }) => ({
      item: { ...fragment, via },
      score: via.reduce((sum, anchor) => sum + weight(anchor), 0),
    }))
    .toSorted((a, b) => b.score - a.score)
    .map(({ item }) => item);
};

// Only a dropped cue match counts as truncated: a dropped association comes
// back through its own cue or anchor, not through a better cue.
const droppedMatch = (items: readonly RecallItem[]) =>
  items.some((item) => !item.via);

const cut = (
  items: readonly RecallItem[],
  truncated: boolean
): RecallResult => ({
  fragments: items.slice(0, RESULT_SIZE),
  truncated: truncated || droppedMatch(items.slice(RESULT_SIZE)),
});

// How likely each candidate is to help with the cue and context, 0 to 1, for
// every candidate, or why not. Jev on Workers AI in production.
export type Judge = (
  candidates: readonly Fragment[],
  input: RecallInput
) => Promise<Result<Map<string, number>, RelevanceUnavailable>>;

// Keeps the candidates the judge finds relevant at this strictness, in
// order. It never passes on a candidate it did not judge: it cuts to its
// budget first, and fails the recall if it cannot judge (RFC 0002,
// decision 5).
export const filterRelevant = async (
  judge: Judge,
  items: readonly RecallItem[],
  input: RecallInput,
  strictness: Strictness
): Promise<
  Result<{ items: RecallItem[]; truncated: boolean }, RelevanceUnavailable>
> => {
  const judged = items.slice(0, JUDGE_BUDGET);
  const truncated = droppedMatch(items.slice(JUDGE_BUDGET));
  if (judged.length === 0) {
    return ok({ items: [], truncated });
  }
  const scores = await judge(judged, input);
  if (!scores.ok) {
    return scores;
  }
  const threshold = STRICTNESS[strictness];
  return ok({
    items: judged.filter(
      (item) => (scores.value.get(item.ref) ?? 0) >= threshold
    ),
    truncated,
  });
};

// Cue matches, best first, then the memories that share a #tag with them,
// most specific link first; the relevance filter, when the owner turned it
// on, hides the ones that do not help.
export const recall = async (
  {
    judge,
    memory,
  }: {
    judge: Judge;
    memory: Pick<
      Memory,
      "anchors" | "associated" | "count" | "readMetadata" | "search"
    >;
  },
  input: RecallInput
): Promise<Result<RecallResult, RelevanceUnavailable>> => {
  const query = cueTerms(input.cue);
  const [settings, hits] = await Promise.all([
    readSettings(memory),
    query.length > 0 ? memory.search(query) : [],
  ]);
  const matches = selectMatches(input.cue, query, hits);
  const keys = seedKeys(matches);
  const [found, anchors, size] =
    keys.length > 0
      ? await Promise.all([
          memory.associated(keys),
          memory.anchors(),
          memory.count(),
        ])
      : [[], [], 0];
  let items: RecallItem[] = [
    ...matches,
    ...rankAssociations(found, matches, anchors, size),
  ];
  let truncated = false;
  if (settings.relevanceFilter !== "off") {
    const filtered = await filterRelevant(
      judge,
      items,
      input,
      settings.relevanceFilter
    );
    if (!filtered.ok) {
      return err(filtered.error);
    }
    ({ items, truncated } = filtered.value);
  }
  return ok(cut(items, truncated));
};
