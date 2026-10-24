import { inMemory } from "@core";
import type { Fragment } from "@core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  JEV_ATTEMPTS,
  JEV_MODEL,
  JEV_TIMEOUT_MS,
  jev,
} from "../../worker/clients/jev";
import type { Ai } from "../../worker/clients/jev";
import {
  JUDGE_BUDGET,
  keepOnlyJudgedRelevant,
  recall,
} from "../../worker/services/memory/recall";
import type { RecallItem } from "../../worker/services/memory/recall";
import type { Strictness } from "../../worker/services/settings";

const item = (ref: string, fragment: string, via?: string[]): RecallItem => ({
  at: "",
  fragment,
  ref,
  ...(via && { via }),
});

const items = [
  item("f7", "Run database migrations with wrangler d1 migrations apply"),
  item("f2", "D1's primary region is in US West", ["d1"]),
  item("f8", "Bird migration season is autumn", ["migration"]),
  item("fx", "Sometimes unanswered by the model", ["d1"]),
];
const corpus: Fragment[] = items.map(({ at, fragment, ref }) => ({
  at,
  fragment,
  ref,
}));
const input = { context: "Deploying the D1 schema", cue: "migration" };
const noul = (scores: Record<string, number>) => ({
  answers: Object.fromEntries(
    Object.entries(scores).map(([ref, value]) => [
      ref,
      { noul: value, type: "noul" },
    ])
  ),
  model: "jev-1.13.0",
});

type Run = Ai["run"];
type Json = Awaited<ReturnType<Run>>;

const asked = (request: Json | undefined) =>
  Object.keys(
    z.object({ questions: z.record(z.string(), z.json()) }).parse(request)
      .questions
  );

const approveAll: Run = (_model, request) =>
  Promise.resolve(
    noul(Object.fromEntries(asked(request).map((ref) => [ref, 0.9])))
  );

const SCORES = { f2: 0.6, f7: 0.9, f8: 0.35, fx: 0.15 };
const scored = () => Promise.resolve(noul(SCORES));

const stage = (
  run: Run,
  rows: RecallItem[] = items,
  strictness: Strictness = "medium"
) => keepOnlyJudgedRelevant(jev({ run }), rows, input, strictness);

const refs = (result: Awaited<ReturnType<typeof stage>>) =>
  result.ok ? result.value.items.map((row) => row.ref) : result.error;

const failed = (retry: boolean) => ({
  error: expect.objectContaining({
    code: "unavailable",
    reason: "relevance-unavailable",
    retry,
  }),
  ok: false,
});

const malformed = () => Promise.resolve({ answers: { f2: { noul: "yes" } } });

describe("Relevance filter", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockReturnValue();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks one noul per candidate, cue matches included, with cue and context", async () => {
    const run = vi.fn<Run>(scored);
    await expect(stage(run).then(refs)).resolves.toStrictEqual([
      "f7",
      "f2",
      "f8",
    ]);
    expect(run).toHaveBeenCalledExactlyOnceWith(JEV_MODEL, {
      questions: {
        f2: expect.objectContaining({ type: "noul" }),
        f7: expect.objectContaining({ type: "noul" }),
        f8: expect.objectContaining({ type: "noul" }),
        fx: expect.objectContaining({ type: "noul" }),
      },
      state: {
        candidates: Object.fromEntries(
          items.map((row) => [row.ref, row.fragment])
        ),
        context: "Deploying the D1 schema",
        cue: "migration",
      },
    });
  });

  it("reads scores from the Workers AI gateway envelope", async () => {
    const run = vi.fn<Run>(() =>
      Promise.resolve({
        gatewayMetadata: { keySource: "Unified" },
        result: noul(SCORES),
        state: "Completed",
      })
    );
    await expect(stage(run).then(refs)).resolves.toStrictEqual([
      "f7",
      "f2",
      "f8",
    ]);
  });

  it.each([
    ["low", ["f7", "f2", "f8", "fx"]],
    ["medium", ["f7", "f2", "f8"]],
    ["high", ["f7", "f2"]],
    ["max", ["f7"]],
  ] as const)(
    "drops more as strictness rises: %s",
    async (strictness, kept) => {
      await expect(
        stage(scored, items, strictness).then(refs)
      ).resolves.toStrictEqual(kept);
    }
  );

  it("asks again only about the candidates the model left unanswered", async () => {
    const run = vi
      .fn<Run>()
      .mockResolvedValueOnce(noul({ f2: 0.6, f7: 0.9, f8: 0.1 }))
      .mockResolvedValueOnce(noul({ fx: 0.8 }));
    await expect(stage(run).then(refs)).resolves.toStrictEqual([
      "f7",
      "f2",
      "fx",
    ]);
    expect(asked(run.mock.calls[1]?.[1])).toStrictEqual(["fx"]);
  });

  it("fails the recall, never passing an unjudged candidate, when one stays unanswered", async () => {
    const run = vi.fn<Run>(() =>
      Promise.resolve(noul({ f2: 0.9, f7: 0.9, f8: 0.9 }))
    );
    await expect(stage(run)).resolves.toStrictEqual(failed(true));
    expect(run).toHaveBeenCalledTimes(JEV_ATTEMPTS);
  });

  it.each([
    [
      "a capacity error",
      new Error(
        "AiError: 3040: Capacity temporarily exceeded, please try again."
      ),
    ],
    ["an upstream error", new Error("InferenceUpstreamError: 502 Bad Gateway")],
  ])("retries %s", async (_name, error) => {
    const run = vi
      .fn<Run>()
      .mockRejectedValueOnce(error)
      .mockImplementationOnce(scored);
    await expect(stage(run).then(refs)).resolves.toStrictEqual([
      "f7",
      "f2",
      "f8",
    ]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "the message",
      new Error("AiError: 3036: You have used up your daily free allocation"),
    ],
    [
      "a code property",
      Object.assign(new Error("No such model"), { code: 5007 }),
    ],
    ["no code at all", new Error("Binding AI needs to be run remotely")],
  ])(
    "fails at once on a persistent error named in %s",
    async (_name, error) => {
      const run = vi.fn<Run>(() => Promise.reject(error));
      await expect(stage(run)).resolves.toStrictEqual(failed(false));
      expect(run).toHaveBeenCalledOnce();
      expect(console.error).toHaveBeenCalledWith({
        error: String(error),
        event: "jev.unavailable",
      });
    }
  );

  it("fails as transient once every attempt has timed out", async () => {
    vi.useFakeTimers();
    await Promise.all([
      expect(
        stage(() => Promise.withResolvers<Json>().promise)
      ).resolves.toStrictEqual(failed(true)),
      vi.advanceTimersByTimeAsync(JEV_TIMEOUT_MS * JEV_ATTEMPTS + 1000),
    ]);
  });

  it.each([
    ["only associations", 1, JUDGE_BUDGET + 5, false],
    ["a cue match", JUDGE_BUDGET + 1, 0, true],
  ])(
    "judges at most its budget and reports a cut of %s as %s",
    async (_name, matches, associations, truncated) => {
      const rows = [
        ...Array.from({ length: matches }, (_, index) =>
          item(`m${index}`, "Match")
        ),
        ...Array.from({ length: associations }, (_, index) =>
          item(`a${index}`, "Association", ["d1"])
        ),
      ];
      const run = vi.fn<Run>(approveAll);
      const result = await stage(run, rows);
      expect(result).toMatchObject({
        ok: true,
        value: { items: { length: JUDGE_BUDGET }, truncated },
      });
      expect(asked(run.mock.calls[0]?.[1])).toHaveLength(JUDGE_BUDGET);
    }
  );

  it("skips the model when there is nothing to judge", async () => {
    const run = vi.fn<Run>(approveAll);
    await expect(stage(run, [])).resolves.toStrictEqual({
      ok: true,
      value: { items: [], truncated: false },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("fails the recall as persistent when no response parses", async () => {
    const result = await recall(
      inMemory(corpus, { settings: { relevanceFilter: "medium" } }),
      input,
      jev({ run: malformed })
    );
    expect(result).toStrictEqual(failed(false));
  });
});
