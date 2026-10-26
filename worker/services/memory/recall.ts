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

const RESULT_SIZE = 10;
const MAX_SEED_MATCHES = 10;

interface Budget {
  count: number;
  tokens: number;
}

// Jev reads all candidates in one state, which must fit in 32k tokens, and
// each candidate adds a question to a request capped at 64k tokens.
export const JUDGE_BUDGET: Budget = { count: 50, tokens: 28_000 };
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

const droppedMatch = (items: readonly RecallItem[]) =>
  items.some((item) => !item.via);

const cut = (
  items: readonly RecallItem[],
  truncated: boolean
): RecallResult => ({
  fragments: items.slice(0, RESULT_SIZE),
  truncated: truncated || droppedMatch(items.slice(RESULT_SIZE)),
});

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
const UTF8_BYTES_PER_TOKEN_AT_MOST = 3;

const estimatedTokens = (item: Fragment) =>
  Math.ceil(
    encoder.encode(item.fragment).length / UTF8_BYTES_PER_TOKEN_AT_MOST
  );

const tokensOf = (items: readonly Fragment[]) =>
  items.reduce((sum, item) => sum + estimatedTokens(item), 0);

const leadingItemsWithin = (
  items: readonly RecallItem[],
  budget: Budget
): RecallItem[] => {
  const taken: RecallItem[] = [];
  let tokens = 0;
  for (const item of items) {
    tokens += estimatedTokens(item);
    if (taken.length >= budget.count || tokens > budget.tokens) {
      break;
    }
    taken.push(item);
  }
  return taken;
};

const candidatesWithin = (items: readonly RecallItem[], budget: Budget) => {
  const matches = items.filter((item) => !item.via);
  const associations = items.filter((item) => item.via);
  const reserved = leadingItemsWithin(associations, {
    count: Math.floor(budget.count * ASSOCIATION_SHARE),
    tokens: budget.tokens * ASSOCIATION_SHARE,
  });
  const keptMatches = leadingItemsWithin(matches, {
    count: budget.count - reserved.length,
    tokens: budget.tokens - tokensOf(reserved),
  });
  const keptAssociations = leadingItemsWithin(associations, {
    count: budget.count - keptMatches.length,
    tokens: budget.tokens - tokensOf(keptMatches),
  });
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
  const { candidates, truncated } = candidatesWithin(items, JUDGE_BUDGET);
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
          Number(Boolean(a.via)) - Number(Boolean(b.via)) || score(b) - score(a)
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
  return ok(cut(filtered.value.items, filtered.value.truncated));
};
