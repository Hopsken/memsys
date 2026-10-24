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

import type { RelevanceUnavailable } from "../errors";
import { SettingsService } from "./settings";
import type { Strictness } from "./settings";

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
        "What you need, as a few distinctive words, a phrase, or #anchors. Matches contain every word; a cue of three or more words may miss one. Fragments sharing an #anchor with a match come too. Too few results: use fewer or other words, or an #anchor. `truncated`: add a distinctive word."
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
const MAX_ASSOCIATIONS_RANKED = 100;
export const JUDGE_BUDGET = 40;

const STRICTNESS = {
  high: 0.5,
  low: 0.1,
  max: 0.7,
  medium: 0.3,
} satisfies Record<Strictness, number>;

const normalize = (text: string): string =>
  text.toLowerCase().replaceAll(/\s+/gu, " ").trim();

const cueTerms = (cue: string) => [...new Set(terms(cue))];

const selectMatches = (
  cue: string,
  query: readonly string[],
  hits: readonly SearchHit[]
): Fragment[] => {
  const required = query.length >= 3 ? query.length - 1 : query.length;
  const phrase = normalize(cue);
  return hits
    .map((hit) => ({
      ...hit,
      phrase: normalize(hit.fragment.fragment).includes(phrase),
    }))
    .filter((hit) => hit.phrase || hit.matchedTerms.length >= required)
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

export class RecallService {
  readonly #memory: RecallMemory;
  readonly #judge: Judge;
  readonly #settings: SettingsService;

  constructor(memory: RecallMemory, judge: Judge) {
    this.#memory = memory;
    this.#judge = judge;
    this.#settings = new SettingsService(memory);
  }

  async recall(
    input: RecallInput
  ): Promise<Result<RecallResult, RelevanceUnavailable>> {
    const memory = this.#memory;
    const query = cueTerms(input.cue);
    const [settings, hits] = await Promise.all([
      this.#settings.read(),
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
      ...rankByRarestSharedAnchor(found, matches, anchors, size),
    ];
    let truncated = false;
    if (settings.relevanceFilter !== "off") {
      const filtered = await this.keepOnlyJudgedRelevant(
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
  }

  async keepOnlyJudgedRelevant(
    items: readonly RecallItem[],
    input: RecallInput,
    strictness: Strictness
  ): Promise<
    Result<{ items: RecallItem[]; truncated: boolean }, RelevanceUnavailable>
  > {
    const judged = items.slice(0, JUDGE_BUDGET);
    const truncated = droppedMatch(items.slice(JUDGE_BUDGET));
    if (judged.length === 0) {
      return ok({ items: [], truncated });
    }
    const scores = await this.#judge(judged, input);
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
  }
}
