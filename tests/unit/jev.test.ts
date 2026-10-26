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
import { workersAiFetch } from "../../worker/clients/workers-ai";
import type { WorkersAiBinding } from "../../worker/clients/workers-ai";
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
const input = { context: "Deploying the D1 schema", cues: ["migration"] };
const noul = (scores: Record<string, number>) => ({
  answers: Object.fromEntries(
    Object.entries(scores).map(([ref, value]) => [
      ref,
      { noul: value, type: "noul" },
    ])
  ),
  model: "jev-1.13.0",
});

type Run = WorkersAiBinding["run"];
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
) =>
  keepOnlyJudgedRelevant(jev(workersAiFetch({ run })), rows, input, strictness);

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
  ] as const)(
    "drops more as strictness rises: %s",
    async (strictness, kept) => {
      await expect(
        stage(scored, items, strictness).then(refs)
      ).resolves.toStrictEqual(kept);
    }
  );

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
    ["a code it does not list", new Error("Error: 5016: Unknown error")],
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

  const rows = (matches: number, associations: number, fragment = "Short") => [
    ...Array.from({ length: matches }, (_, index) =>
      item(`m${index}`, fragment)
    ),
    ...Array.from({ length: associations }, (_, index) =>
      item(`a${index}`, fragment, ["d1"])
    ),
  ];
  const THREE_THOUSAND_CHARACTER_CANDIDATES_JEV_ACCEPTS = 40;
  const askedRefs = (run: ReturnType<typeof vi.fn<Run>>, call = 0) =>
    asked(run.mock.calls[call]?.[1]);

  it("keeps room for associations when cue matches alone would fill the budget", async () => {
    const run = vi.fn<Run>(approveAll);
    const result = await stage(run, rows(JUDGE_BUDGET.count, 50));
    const judged = askedRefs(run);
    expect(judged).toHaveLength(JUDGE_BUDGET.count);
    expect(judged.filter((ref) => ref.startsWith("a")).length).toBeGreaterThan(
      0
    );
    expect(result).toMatchObject({ ok: true, value: { truncated: true } });
  });

  it("gives unused association room to cue matches, and a cut of associations is not truncated", async () => {
    const onlyMatches = vi.fn<Run>(approveAll);
    await expect(
      stage(onlyMatches, rows(JUDGE_BUDGET.count, 0))
    ).resolves.toMatchObject({ ok: true, value: { truncated: false } });
    expect(askedRefs(onlyMatches)).toHaveLength(JUDGE_BUDGET.count);

    const manyAssociations = vi.fn<Run>(approveAll);
    await expect(
      stage(manyAssociations, rows(1, JUDGE_BUDGET.count + 5))
    ).resolves.toMatchObject({ ok: true, value: { truncated: false } });
    expect(askedRefs(manyAssociations)).toHaveLength(JUDGE_BUDGET.count);
  });

  it("asks no more 3000-character candidates than fit in Jev's context, in rank order", async () => {
    const run = vi.fn<Run>(approveAll);
    await stage(run, rows(200, 0, "x".repeat(3000)));
    const judged = askedRefs(run);
    expect(judged.length).toBeLessThanOrEqual(
      THREE_THOUSAND_CHARACTER_CANDIDATES_JEV_ACCEPTS
    );
    expect(judged.length).toBeGreaterThanOrEqual(20);
    expect(judged).toStrictEqual(
      Array.from({ length: judged.length }, (_, index) => `m${index}`)
    );
  });

  const tooLarge = new Error("Error: 7003: User Input Error");

  it("judges every candidate in two halves when Jev says the input is too large", async () => {
    const run = vi
      .fn<Run>()
      .mockRejectedValueOnce(tooLarge)
      .mockImplementation(approveAll);
    const result = await stage(run, rows(31, 19));
    const all = askedRefs(run, 0);
    const [first, second] = [askedRefs(run, 1), askedRefs(run, 2)];
    expect(run).toHaveBeenCalledTimes(3);
    expect(first.filter((ref) => second.includes(ref))).toStrictEqual([]);
    expect([...first, ...second].toSorted()).toStrictEqual(all.toSorted());
    expect(result).toStrictEqual({
      ok: true,
      value: {
        items: all.map((ref) => expect.objectContaining({ ref })),
        truncated: false,
      },
    });
  });

  it("keeps splitting while a part is still too large", async () => {
    const run = vi.fn<Run>((model, request) =>
      asked(request).length > 15
        ? Promise.reject(tooLarge)
        : approveAll(model, request)
    );
    const result = await stage(run, rows(50, 0));
    const judged = run.mock.results
      .map((_, call) => askedRefs(run, call))
      .filter((part) => part.length <= 15)
      .flat();
    expect(judged.toSorted()).toStrictEqual(askedRefs(run, 0).toSorted());
    expect(result).toMatchObject({
      ok: true,
      value: { items: { length: 50 }, truncated: false },
    });
  });

  it("stops splitting after two rounds when every part is rejected", async () => {
    const run = vi.fn<Run>(() => Promise.reject(tooLarge));
    await expect(stage(run, rows(100, 0))).resolves.toStrictEqual(
      failed(false)
    );
    expect(run).toHaveBeenCalledTimes(1 + 2 + 4);
  });

  it("orders kept candidates by score, cue matches still first", async () => {
    const run: Run = () =>
      Promise.resolve(noul({ a0: 0.9, a1: 0.5, m0: 0.4, m1: 0.8 }));
    await expect(stage(run, rows(2, 2)).then(refs)).resolves.toStrictEqual([
      "m1",
      "m0",
      "a0",
      "a1",
    ]);
  });

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
      inMemory(corpus),
      input,
      jev(workersAiFetch({ run: malformed }))
    );
    expect(result).toStrictEqual(failed(false));
  });
});
