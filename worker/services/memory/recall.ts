import type {
  AnchorCount,
  Association,
  Fragment,
  Memory,
  SearchHit,
} from "@core";
import { z } from "zod";

import { terms } from "@lib/analyzer";
import { associationKeys, extractAnchors } from "@lib/anchor";
import { err, ok } from "@lib/result";
import type { Result } from "@lib/result";

import type { RelevanceUnavailable } from "../../errors";
import { SettingsService } from "../settings";
import type { Strictness } from "../settings";

const cueSchema = z.string().trim().min(1).max(256);

const MAX_CUES_LENGTH = 1000;

const cueListSchema = z
  .array(cueSchema)
  .min(1)
  .refine(
    (cues) => cues.join("").length <= MAX_CUES_LENGTH,
    `All cues together must be at most ${MAX_CUES_LENGTH} characters.`
  );

const singleCueAsListSchema = cueSchema.transform((cue) => [cue]);

export const recallContextSchema = z.string().max(1000).optional();

export const recallCuesSchema = z.union([cueListSchema, singleCueAsListSchema]);

export const recallInputSchema = z
  .object({ context: recallContextSchema, cues: recallCuesSchema })
  .strict();

export type RecallInput = z.infer<typeof recallInputSchema>;

export type RecallItem = Fragment & { via?: string[] };

export interface RecallResult {
  fragments: RecallItem[];
  truncated: boolean;
}

const MAX_SEED_MATCHES = 10;

// Holds one fragment at the longest length, so a result is never empty, and
// about ten of the usual size.
const RESULT_TOKEN_BUDGET = 1000;

// Jev bills the state once and every question on top; the state must fit in
// 32k tokens and the request in 64k. The budget counts what a candidate costs
// in both: its text, its entry in the state, and its question. 20k estimated
// tokens keeps the state under 32k even when the estimate runs low on Chinese.
const JUDGE_TOKEN_BUDGET = 20_000;
const ASSOCIATION_SHARE = 0.3;

const STRICTNESS = {
  low: 0.1,
  medium: 0.3,
} satisfies Record<Strictness, number>;

const normalize = (text: string): string =>
  text.toLowerCase().replaceAll(/\s+/gu, " ").trim();

const cueTerms = (cue: string) => [...new Set(terms(cue))];

const rankMatches = (cue: string, hits: readonly SearchHit[]): Fragment[] => {
  const phrase = normalize(cue);
  return hits
    .map((hit) => ({
      ...hit,
      phrase: normalize(hit.fragment.fragment).includes(phrase),
    }))
    .toSorted(
      (a, b) =>
        Number(b.phrase) - Number(a.phrase) ||
        b.matchedTerms.length - a.matchedTerms.length ||
        b.score - a.score
    )
    .map((hit) => hit.fragment);
};

// https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf
const RECIPROCAL_RANK_K = 60;

const fuseByReciprocalRank = (lists: readonly Fragment[][]): Fragment[] => {
  const scored = new Map<string, { fragment: Fragment; score: number }>();
  for (const list of lists) {
    for (const [rank, fragment] of list.entries()) {
      const entry = scored.get(fragment.ref) ?? { fragment, score: 0 };
      entry.score += 1 / (RECIPROCAL_RANK_K + rank);
      scored.set(fragment.ref, entry);
    }
  }
  return [...scored.values()]
    .toSorted((a, b) => b.score - a.score)
    .map((entry) => entry.fragment);
};

const seedKeys = (matches: readonly Fragment[]) => [
  ...new Set(
    matches
      .slice(0, MAX_SEED_MATCHES)
      .flatMap((item) => extractAnchors(item.fragment).flatMap(associationKeys))
  ),
];

const rankByRarestSharedAnchor = (
  found: readonly Association[],
  matches: readonly Fragment[],
  anchors: readonly AnchorCount[],
  corpusSize: number
): RecallItem[] => {
  const matched = new Set(matches.map((item) => item.ref));
  const df = new Map(anchors.map((item) => [item.anchor, item.fragmentCount]));
  const inverseDocumentFrequency = (anchor: string) =>
    Math.log((corpusSize + 1) / ((df.get(anchor) ?? 0) + 1));
  return found
    .filter((item) => !matched.has(item.fragment.ref))
    .map(({ fragment, via }) => ({
      item: { ...fragment, via },
      score: via.reduce(
        (sum, anchor) => sum + inverseDocumentFrequency(anchor),
        0
      ),
    }))
    .toSorted((a, b) => b.score - a.score)
    .map(({ item }) => item);
};

export type Judge = (
  candidates: readonly Fragment[],
  input: RecallInput
) => Promise<Result<Map<string, number>, RelevanceUnavailable>>;

type RecallMemory = Pick<
  Memory,
  | "anchors"
  | "associated"
  | "count"
  | "patchMetadata"
  | "readMetadata"
  | "search"
>;

const encoder = new TextEncoder();
// Jev bills about 5 bytes per token for English text and 2.5 for Chinese, so
// 4 overestimates English text by a tenth and underestimates Chinese text by
// up to two fifths.
const UTF8_BYTES_PER_TOKEN = 4;

const textTokens = (item: Fragment) =>
  Math.ceil(encoder.encode(item.fragment).length / UTF8_BYTES_PER_TOKEN);

// Measured: 33 tokens for a candidate's question, about 16 for its state entry.
const CANDIDATE_OVERHEAD_TOKENS = 50;

const judgeTokens = (item: Fragment) =>
  CANDIDATE_OVERHEAD_TOKENS + textTokens(item);

type Tokens = (item: Fragment) => number;

const tokensOf = (items: readonly Fragment[], tokens: Tokens) =>
  items.reduce((sum, item) => sum + tokens(item), 0);

const leadingItemsWithin = (
  items: readonly RecallItem[],
  budget: number,
  tokens: Tokens
): RecallItem[] => {
  const taken: RecallItem[] = [];
  let used = 0;
  for (const item of items) {
    used += tokens(item);
    if (used > budget) {
      break;
    }
    taken.push(item);
  }
  return taken;
};

const candidatesWithin = (items: readonly RecallItem[], budget: number) => {
  const matches = items.filter((item) => !item.via);
  const associations = items.filter((item) => item.via);
  const reserved = leadingItemsWithin(
    associations,
    budget * ASSOCIATION_SHARE,
    judgeTokens
  );
  const keptMatches = leadingItemsWithin(
    matches,
    budget - tokensOf(reserved, judgeTokens),
    judgeTokens
  );
  const keptAssociations = leadingItemsWithin(
    associations,
    budget - tokensOf(keptMatches, judgeTokens),
    judgeTokens
  );
  return {
    candidates: [...keptMatches, ...keptAssociations],
    truncated: keptMatches.length < matches.length,
  };
};

export const keepOnlyJudgedRelevant = async (
  judge: Judge,
  items: readonly RecallItem[],
  input: RecallInput,
  strictness: Strictness
): Promise<
  Result<{ items: RecallItem[]; truncated: boolean }, RelevanceUnavailable>
> => {
  const { candidates, truncated } = candidatesWithin(items, JUDGE_TOKEN_BUDGET);
  if (candidates.length === 0) {
    return ok({ items: [], truncated });
  }
  const scores = await judge(candidates, input);
  if (!scores.ok) {
    return scores;
  }
  const threshold = STRICTNESS[strictness];
  const score = (item: RecallItem) => scores.value.get(item.ref) ?? 0;
  return ok({
    items: candidates
      .filter((item) => score(item) >= threshold)
      .toSorted(
        (a, b) =>
          score(b) - score(a) || Number(Boolean(a.via)) - Number(Boolean(b.via))
      ),
    truncated,
  });
};

export const recall = async (
  memory: RecallMemory,
  input: RecallInput,
  judge: Judge
): Promise<Result<RecallResult, RelevanceUnavailable>> => {
  const cues = [...new Set(input.cues)];
  const [{ relevanceFilter }, ...matchLists] = await Promise.all([
    new SettingsService(memory).read(),
    ...cues.map(async (cue) => {
      const query = cueTerms(cue);
      return rankMatches(
        cue,
        query.length > 0 ? await memory.search(query) : []
      );
    }),
  ]);
  const matches = fuseByReciprocalRank(matchLists);
  const keys = seedKeys(matches);
  const [found, anchors, size] =
    keys.length > 0
      ? await Promise.all([
          memory.associated(keys),
          memory.anchors(),
          memory.count(),
        ])
      : [[], [], 0];
  const items: RecallItem[] = [
    ...matches,
    ...rankByRarestSharedAnchor(found, matches, anchors, size),
  ];
  const filtered = await keepOnlyJudgedRelevant(
    judge,
    items,
    input,
    relevanceFilter
  );
  if (!filtered.ok) {
    return err(filtered.error);
  }
  const fragments = leadingItemsWithin(
    filtered.value.items,
    RESULT_TOKEN_BUDGET,
    textTokens
  );
  return ok({
    fragments,
    truncated:
      filtered.value.truncated ||
      fragments.length < filtered.value.items.length,
  });
};
