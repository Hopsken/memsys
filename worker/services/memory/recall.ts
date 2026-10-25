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

export const recallInputSchema = z
  .object({
    context: z
      .string()
      .max(1000)
      .optional()
      .describe(
        "What you are working on right now. Give it whenever you have a task: it helps pick the memories that matter for it."
      ),
    cues: z
      .union([cueListSchema, singleCueAsListSchema])
      .describe(
        "What you need, one cue per angle. Each cue is a few distinctive words, a phrase, or #anchors."
      ),
  })
  .strict();

export type RecallInput = z.infer<typeof recallInputSchema>;

export type RecallItem = Fragment & { via?: string[] };

export interface RecallResult {
  fragments: RecallItem[];
  truncated: boolean;
}

const RESULT_SIZE = 10;
const MAX_SEED_MATCHES = 10;
export const JUDGE_BUDGET = 40;

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

export const keepOnlyJudgedRelevant = async (
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
