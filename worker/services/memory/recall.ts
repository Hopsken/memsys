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
import { ok } from "@lib/result";
import type { Result } from "@lib/result";

import { RELEVANCE_UNCHECKED } from "../../errors";
import type { RelevanceUnavailable } from "../../errors";
import { SettingsService } from "../settings";
import type { Strictness } from "../settings";

export const recallInputSchema = z
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
        "What you need, as a few distinctive words, a phrase, or #anchors."
      ),
  })
  .strict();

export type RecallInput = z.infer<typeof recallInputSchema>;

export type RecallItem = Fragment & { via?: string[] };

export interface RecallResult {
  fragments: RecallItem[];
  truncated: boolean;
  warnings?: string[];
}

const RESULT_SIZE = 10;
const MAX_SEED_MATCHES = 10;
const MAX_ASSOCIATIONS_RANKED = 100;
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
    .slice(0, MAX_ASSOCIATIONS_RANKED)
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
): Promise<RecallResult> => {
  const query = cueTerms(input.cue);
  const [{ relevanceFilter }, hits] = await Promise.all([
    new SettingsService(memory).read(),
    query.length > 0 ? memory.search(query) : [],
  ]);
  const matches = rankMatches(input.cue, hits);
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
  if (filtered.ok) {
    return cut(filtered.value.items, filtered.value.truncated);
  }
  // A failing filter must not cut the agent off from its memories. The
  // warning and the log make the failure visible so it gets fixed.
  console.error({ event: "recall.unfiltered", retry: filtered.error.retry });
  return { ...cut(items, false), warnings: [RELEVANCE_UNCHECKED] };
};
