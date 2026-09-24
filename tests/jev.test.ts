import { afterEach, describe, expect, it, vi } from "vitest";

import type { Fragment, RecallItem } from "../contract/memory";
import type { Ctx, Json } from "../contract/plugin";
import { RECALL_LIMIT_MAX } from "../lib/recall";
import { JEV_MODEL, JEV_TIMEOUT_MS, jev } from "../plugins/jev";
import { createCtx, runAfterRecall } from "../worker/plugin-host";

const item = (ref: string, fragment: string, via?: string[]): RecallItem => ({
  createdAt: "",
  fragment,
  ref,
  updatedAt: "",
  ...(via && { via }),
});

// The seed corpus's ambiguity case: "migration" means databases or birds.
const items = [
  item("f7", "Run database migrations with wrangler d1 migrations apply"),
  item("f2", "D1's primary region is in US West", ["d1"]),
  item("f8", "Bird migration season is autumn", ["migration"]),
  item("fx", "Unanswered by the model", ["d1"]),
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

const malformed = () => Promise.resolve({ answers: { f2: { noul: "yes" } } });

const hook = (run: Run, rows: RecallItem[], config = jev.defaults.config) => {
  if (!jev.afterRecall) {
    throw new Error("jev has no afterRecall hook");
  }
  return jev.afterRecall(
    createCtx(config, { ai: { run }, corpus }),
    rows,
    input
  );
};

const gate = (run: Run, config = jev.defaults.config) =>
  hook(run, items, config);

const refs = (rows: RecallItem[]) => rows.map((row) => row.ref);

describe("jev plugin", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks one noul per association with cue and context in the state", async () => {
    const run = vi.fn<Run>(() => Promise.resolve(noul({ f2: 0.9, f8: 0.1 })));
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
          fx: "Unanswered by the model",
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

  it("gates cue matches when configured", async () => {
    const run = vi.fn<Run>(() =>
      Promise.resolve(noul({ f2: 0.6, f7: 0.2, f8: 0.4, fx: 0.8 }))
    );
    await expect(
      gate(run, { matches: true, strictness: "medium" }).then(refs)
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

  it("drops associations past its cap instead of passing them unjudged", async () => {
    const many = Array.from({ length: RECALL_LIMIT_MAX + 5 }, (_, index) =>
      item(`a${index}`, `Association ${index}`, ["d1"])
    );
    const run = vi.fn<Run>(() => Promise.resolve(noul({})));
    await expect(
      hook(run, [item("m", "Cue match"), ...many]).then((rows) => rows.length)
    ).resolves.toBe(RECALL_LIMIT_MAX + 1);
  });

  it("rejects malformed responses so the host passes recall through", async () => {
    const log = vi.spyOn(console, "error").mockReturnValue();
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
    expect(result).toStrictEqual(items);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Error: Unexpected Jev response (keys: answers)",
      })
    );
  });

  it("gives up after its time budget", async () => {
    vi.useFakeTimers();
    await Promise.all([
      expect(gate(() => Promise.withResolvers<Json>().promise)).rejects.toThrow(
        `Jev timed out after ${JEV_TIMEOUT_MS} ms`
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
