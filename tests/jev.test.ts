import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Fragment, RecallItem } from "../contract/memory";
import { PluginAbortError } from "../contract/plugin";
import type { Ctx, Json } from "../contract/plugin";
import { RECALL_LIMIT_MAX } from "../lib/recall";
import { plugins } from "../plugins";
import {
  JEV_BATCH,
  JEV_MAX_JUDGED,
  JEV_MODEL,
  JEV_TIMEOUT_MS,
  jev,
} from "../plugins/jev";
import { recallCandidates, truncate } from "../worker/memory";
import {
  createCtx,
  resolvePlugins,
  runAfterRecall,
} from "../worker/plugin-host";

const item = (ref: string, fragment: string, via?: string[]): RecallItem => ({
  at: "",
  fragment,
  ref,
  ...(via && { via }),
});

// The seed corpus's ambiguity case: "migration" means databases or birds.
const items = [
  item("f7", "Run database migrations with wrangler d1 migrations apply"),
  item("f2", "D1's primary region is in US West", ["d1"]),
  item("f8", "Bird migration season is autumn", ["migration"]),
  item("fx", "D1 bills per row read", ["d1"]),
];
const corpus = new Map<string, Fragment>(items.map((row) => [row.ref, row]));
const input = {
  associate: true,
  context: "Deploying the D1 schema",
  cue: "migration",
  limit: 20,
};
const noul = (scores: Record<string, number>) => ({
  answers: Object.fromEntries(
    Object.entries(scores).map(([ref, value]) => [
      ref,
      { noul: value, type: "noul" },
    ])
  ),
  model: "jev-1.13.0",
});

type Run = Ctx<Json>["ai"]["run"];

// Answers every question in a request with `score(ref)`.
const scoring = (score: (ref: string) => number) =>
  vi.fn<Run>((_, body) => {
    const { questions } = z
      .object({ questions: z.record(z.string(), z.unknown()) })
      .parse(body);
    return Promise.resolve(
      noul(
        Object.fromEntries(
          Object.keys(questions).map((ref) => [ref, score(ref)])
        )
      )
    );
  });

const malformed = () => Promise.resolve({ answers: { f2: { noul: "yes" } } });

// Most cases exercise association gating; defaults also judge cue matches.
const ASSOCIATIONS = { matches: false, strictness: "medium" } as const;

const hook = (
  run: Run,
  rows: RecallItem[],
  config: Json = ASSOCIATIONS,
  limit = input.limit
) => {
  if (!jev.afterRecall) {
    throw new Error("jev has no afterRecall hook");
  }
  return jev.afterRecall(createCtx(config, { ai: { run }, corpus }), rows, {
    ...input,
    limit,
  });
};

const gate = (run: Run, config: Json = ASSOCIATIONS) =>
  hook(run, items, config);

const refs = (rows: RecallItem[]) => rows.map((row) => row.ref);

describe("jev plugin", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks one noul per association with cue and context in the state", async () => {
    const run = vi.fn<Run>(() =>
      Promise.resolve(noul({ f2: 0.9, f8: 0.1, fx: 0.9 }))
    );
    await expect(gate(run).then(refs)).resolves.toStrictEqual([
      "f7",
      "f2",
      "fx",
    ]);
    expect(run).toHaveBeenCalledWith(JEV_MODEL, {
      questions: {
        f2: expect.objectContaining({ type: "noul" }),
        f8: expect.objectContaining({ type: "noul" }),
        fx: expect.objectContaining({ type: "noul" }),
      },
      state: {
        candidates: {
          f2: "D1's primary region is in US West",
          f8: "Bird migration season is autumn",
          fx: "D1 bills per row read",
        },
        context: "Deploying the D1 schema",
        cue: "migration",
      },
    });
  });

  it("reads scores from the Workers AI gateway envelope", async () => {
    const run = vi.fn<Run>(() =>
      Promise.resolve({
        gatewayMetadata: { keySource: "Unified" },
        result: noul({ f2: 0.9, f8: 0.1, fx: 0.2 }),
        state: "Completed",
      })
    );
    await expect(gate(run).then(refs)).resolves.toStrictEqual(["f7", "f2"]);
  });

  it("gates cue matches by default", async () => {
    const run = vi.fn<Run>(() =>
      Promise.resolve(noul({ f2: 0.6, f7: 0.2, f8: 0.4, fx: 0.8 }))
    );
    await expect(
      gate(run, jev.defaults.config).then(refs)
    ).resolves.toStrictEqual(["f2", "f8", "fx"]);
  });

  it.each([
    ["low", ["f7", "f2", "f8", "fx"]],
    ["medium", ["f7", "f2", "f8"]],
    ["high", ["f7", "f2"]],
    ["max", ["f7"]],
  ] as const)(
    "drops more as strictness rises: %s",
    async (strictness, kept) => {
      const run = vi.fn<Run>(() =>
        Promise.resolve(noul({ f2: 0.6, f8: 0.35, fx: 0.15 }))
      );
      await expect(
        gate(run, { matches: false, strictness }).then(refs)
      ).resolves.toStrictEqual(kept);
    }
  );

  it("still parses configs saved with the numeric threshold", () => {
    expect(jev.config.parse({ matches: true, threshold: 0.5 })).toStrictEqual({
      matches: true,
      strictness: "medium",
    });
  });

  describe("batches", () => {
    const many = Array.from({ length: JEV_BATCH * 3 }, (_, index) =>
      item(`a${index}`, `Association ${index}`, ["d1"])
    );
    const rows = [item("m", "Cue match"), ...many];
    // Passes every other candidate.
    const judgeHalf = scoring((ref) =>
      Number(ref.slice(1)) % 2 === 0 ? 0.9 : 0.1
    );

    it("stops once more than a page passes and drops the unjudged rest", async () => {
      judgeHalf.mockClear();
      const kept = await hook(judgeHalf, rows, ASSOCIATIONS, 10);
      expect(judgeHalf).toHaveBeenCalledOnce();
      expect(refs(kept)).toStrictEqual([
        "m",
        ...many
          .slice(0, JEV_BATCH)
          .filter((_, index) => index % 2 === 0)
          .map((row) => row.ref),
      ]);
    });

    it("judges every candidate while a page is not full", async () => {
      judgeHalf.mockClear();
      const kept = await hook(judgeHalf, rows, ASSOCIATIONS, 40);
      expect(judgeHalf).toHaveBeenCalledTimes(3);
      expect(kept).toHaveLength(1 + (JEV_BATCH * 3) / 2);
    });

    it("fails when too many candidates are left to fill a page", async () => {
      const crowd = Array.from({ length: JEV_MAX_JUDGED + 1 }, (_, index) =>
        item(`c${index}`, `Crowd ${index}`, ["d1"])
      );
      const none = scoring(() => 0);
      await expect(hook(none, crowd)).rejects.toThrow(PluginAbortError);
      expect(none).toHaveBeenCalledTimes(JEV_MAX_JUDGED / JEV_BATCH);
    });
  });

  // Guards the pipeline, not just the hook: nothing before Jev may cut the
  // candidates down to a page.
  it.each([
    [RECALL_LIMIT_MAX + 20, (RECALL_LIMIT_MAX + 20) / 2, false],
    [RECALL_LIMIT_MAX * 3, RECALL_LIMIT_MAX, true],
  ])(
    "sees every candidate through the full registry: %i matches",
    async (count, returned, hasMore) => {
      const rows = new Map(
        Array.from({ length: count }, (_, index): [string, Fragment] => [
          `m${index}`,
          { at: "", fragment: `Cue ${index}`, ref: `m${index}` },
        ])
      );
      const states = resolvePlugins(plugins, [
        {
          config: jev.defaults.config,
          enabled: true,
          name: "jev",
          updatedAt: 0,
        },
      ]);
      const run = scoring((ref) =>
        Number(ref.slice(1)) % 2 === 0 ? 0.9 : 0.1
      );
      const { candidates, input: recallInput } = recallCandidates(
        rows.values(),
        {
          cue: "cue",
          limit: RECALL_LIMIT_MAX,
        }
      );
      const ranked = await runAfterRecall(
        states,
        { ai: { run }, corpus: rows },
        candidates,
        recallInput
      );
      if ("error" in ranked) {
        throw new Error(ranked.error);
      }
      const result = truncate(ranked, recallInput.limit);
      expect(result.fragments).toHaveLength(returned);
      expect(result.hasMore).toBe(hasMore);
    }
  );

  it("fails recall when the model leaves a candidate unanswered", async () => {
    const run = vi.fn<Run>(() => Promise.resolve(noul({ f2: 0.9, f8: 0.9 })));
    await expect(gate(run)).rejects.toThrow("Jev left fx unanswered");
  });

  it("fails recall on a malformed response instead of passing it through", async () => {
    const result = await runAfterRecall(
      [
        {
          config: jev.defaults.config,
          enabled: true,
          plugin: jev,
          status: "default",
          updatedAt: null,
        },
      ],
      { ai: { run: malformed }, corpus },
      items,
      input
    );
    expect(result).toStrictEqual({
      error:
        "jev: Couldn't check relevance: Unexpected Jev response (keys: answers)",
    });
  });

  it("fails recall after its time budget", async () => {
    vi.useFakeTimers();
    await Promise.all([
      expect(gate(() => Promise.withResolvers<Json>().promise)).rejects.toThrow(
        new PluginAbortError(
          `Couldn't check relevance: Jev timed out after ${JEV_TIMEOUT_MS} ms`
        )
      ),
      vi.advanceTimersByTimeAsync(JEV_TIMEOUT_MS),
    ]);
  });

  it("skips the model when there is nothing to judge", async () => {
    const run = vi.fn<Run>(() => Promise.resolve(noul({})));
    const matchesOnly = items.filter((row) => !row.via);
    await expect(hook(run, matchesOnly)).resolves.toStrictEqual(matchesOnly);
    expect(run).not.toHaveBeenCalled();
  });
});
