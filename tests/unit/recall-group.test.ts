import { inMemory } from "@core";
import type { Fragment } from "@core";
import { describe, expect, it } from "vitest";

import { ok } from "@lib/result";

import { groupByMatch } from "../../client/widgets/recall-preview/lib/group";
import {
  recall as recallWith,
  recallInputSchema,
} from "../../worker/services/memory/recall";
import type { Judge, RecallItem } from "../../worker/services/memory/recall";

// These tests cover what recall finds; the filter keeps all of it.
const keepAll: Judge = (candidates) =>
  Promise.resolve(ok(new Map(candidates.map((item) => [item.ref, 1]))));

const recall = async (corpus: Iterable<Fragment>, raw: { cue: string }) => {
  const result = await recallWith(
    inMemory(corpus),
    recallInputSchema.parse(raw),
    keepAll
  );
  if (!result.ok) {
    throw new Error(result.error.reason);
  }
  return result.value;
};

const at = "2026-09-01T00:00:00.000Z";
const corpus = [
  { at, fragment: "Deploys go through pnpm deploy. #memsys", ref: "m1" },
  { at, fragment: "Tokens rotate monthly. #auth-tokens", ref: "m2" },
  { at, fragment: "Recall favors recall over noise. #memsys", ref: "r1" },
  { at, fragment: "Sessions expire after a week. #auth", ref: "r2" },
  { at, fragment: "Unrelated note. #garden", ref: "x1" },
];

const refs = (items: readonly RecallItem[]) =>
  groupByMatch(items).map(({ match, related }) => [
    match?.ref ?? null,
    related.map((item) => item.ref),
  ]);

describe("Recall grouping", () => {
  it("puts each related memory under the match that brought it in", async () => {
    const { fragments } = await recall(corpus, { cue: "deploy" });
    expect(refs(fragments)).toStrictEqual([["m1", ["r1"]]]);
  });

  it("follows tags the way recall associates them", async () => {
    const { fragments } = await recall(corpus, { cue: "tokens" });
    expect(refs(fragments)).toStrictEqual([["m2", ["r2"]]]);
  });

  it("puts a memory related to several matches under the first", () => {
    const items: RecallItem[] = [
      { at, fragment: "First. #memsys", ref: "a" },
      { at, fragment: "Second. #memsys", ref: "b" },
      { at, fragment: "Related. #memsys", ref: "c", via: ["memsys"] },
    ];
    expect(refs(items)).toStrictEqual([
      ["a", ["c"]],
      ["b", []],
    ]);
  });

  it("keeps related memories whose match isn't in the result", async () => {
    const { fragments } = await recall(corpus, { cue: "deploy" });
    expect(refs(fragments.filter((item) => item.via))).toStrictEqual([
      [null, ["r1"]],
    ]);
  });
});
