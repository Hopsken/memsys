import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Fragment, RecallItem } from "../../contract/memory";
import type { Ctx, Json, StageOutput } from "../../contract/plugin";
import {
  JEV_ATTEMPTS,
  JEV_BUDGET,
  JEV_MODEL,
  JEV_TIMEOUT_MS,
  jev,
} from "../../plugins/jev";
import { createCtx } from "../../worker/plugin-host";
import { runRecall } from "../../worker/recall/host";

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
  item("fx", "Sometimes unanswered by the model", ["d1"]),
];
const corpus = new Map<string, Fragment>(items.map((row) => [row.ref, row]));
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

type Run = Ctx<Json>["ai"]["run"];

// The refs a request asks about.
const asked = (request: Json | undefined) =>
  Object.keys(
    z.object({ questions: z.record(z.string(), z.json()) }).parse(request)
      .questions
  );

// Answers every question it is asked with the same score.
const approveAll: Run = (_model, request) =>
  Promise.resolve(
    noul(Object.fromEntries(asked(request).map((ref) => [ref, 0.9])))
  );

const SCORES = { f2: 0.6, f7: 0.9, f8: 0.35, fx: 0.15 };
const scored = () => Promise.resolve(noul(SCORES));

const stage = (run: Run, rows: RecallItem[] = items, config: Json = {}) => {
  if (!jev.recall) {
    throw new Error("jev has no recall stage");
  }
  return jev.recall(createCtx(config, { ai: { run }, corpus }), rows, input);
};

const refs = ({ items: rows }: StageOutput) => rows.map((row) => row.ref);

const malformed = () => Promise.resolve({ answers: { f2: { noul: "yes" } } });

const RETRY = "Retry this recall shortly.";
const OWNER = "Retrying will not help";

describe("jev plugin", () => {
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
        stage(scored, items, { strictness }).then(refs)
      ).resolves.toStrictEqual(kept);
    }
  );

  it("still parses configs saved with the matches switch or the numeric threshold", () => {
    expect(jev.config.parse({ matches: false, threshold: 0.5 })).toStrictEqual({
      strictness: "medium",
    });
  });

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
    await expect(stage(run)).rejects.toMatchObject({
      message: expect.stringContaining(RETRY),
      retry: true,
    });
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
    // An error with no Workers AI code, such as a missing binding, does not
    // clear on its own.
    ["no code at all", new Error("Binding AI needs to be run remotely")],
  ])(
    "fails at once on a persistent error named in %s",
    async (_name, error) => {
      const run = vi.fn<Run>(() => Promise.reject(error));
      await expect(stage(run)).rejects.toMatchObject({
        message: expect.stringContaining(OWNER),
        retry: false,
      });
      expect(run).toHaveBeenCalledOnce();
    }
  );

  it("fails as transient once every attempt has timed out", async () => {
    vi.useFakeTimers();
    await Promise.all([
      expect(
        stage(() => Promise.withResolvers<Json>().promise)
      ).rejects.toThrow(`Jev timed out after ${JEV_TIMEOUT_MS} ms). ${RETRY}`),
      // Each attempt times out, plus the waits between attempts.
      vi.advanceTimersByTimeAsync(JEV_TIMEOUT_MS * JEV_ATTEMPTS + 1000),
    ]);
  });

  it.each([
    ["only associations", 1, JEV_BUDGET + 5, false],
    ["a cue match", JEV_BUDGET + 1, 0, true],
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
      expect({
        kept: result.items.length,
        truncated: result.truncated,
      }).toStrictEqual({
        kept: JEV_BUDGET,
        truncated,
      });
      expect(asked(run.mock.calls[0]?.[1])).toHaveLength(JEV_BUDGET);
    }
  );

  it("skips the model when there is nothing to judge", async () => {
    const run = vi.fn<Run>(approveAll);
    await expect(stage(run, [])).resolves.toStrictEqual({ items: [] });
    expect(run).not.toHaveBeenCalled();
  });

  it("fails the recall through the host as persistent when no response parses", async () => {
    const result = await runRecall(
      [
        { builtin: "given", stage: () => Promise.resolve({ items }) },
        { plugin: jev },
      ],
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
      input
    );
    // A response that never parses means the model changed: the owner acts.
    expect(result).toStrictEqual({
      error: expect.stringMatching(
        /^jev: Relevance check is unavailable \(JevAttemptError: Unexpected Jev response \(keys: answers\)\)\. Retrying will not help/u
      ),
      retry: false,
    });
  });
});
