import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { inMemory } from "@core";
import type { Fragment } from "@core";
import { afterAll, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { z } from "zod";

import { jev } from "../worker/clients/jev";
import { workersAiFetch } from "../worker/clients/workers-ai";
import {
  recall as recallWith,
  recallInputSchema,
} from "../worker/services/memory/recall";
import { cases, fragments } from "./dataset";
import type { EvalCase } from "./dataset";
import { report } from "./metrics";
import type { Outcome, Run } from "./metrics";

const strictness = z
  .enum(["low", "medium"])
  .parse(process.env["JEV_STRICTNESS"] ?? "low");
const CONCURRENCY = 4;

const corpus: Fragment[] = fragments.map(({ date, fragment, id }) => ({
  at: `${date}T12:00:00.000Z`,
  fragment,
  ref: id,
}));

const proxy = await getPlatformProxy<{ AI: Ai }>({
  configPath: path.join(import.meta.dirname, "wrangler.jsonc"),
  remoteBindings: true,
});

afterAll(async () => {
  await proxy.dispose();
});

const ai = workersAiFetch({
  // SAFETY: the binding's model union has no entry for Jev; the output is
  // parsed as JSON before Jev sees it, as in MemoryDO.
  run: async (model, input) =>
    z.json().parse(await proxy.env.AI.run(model as never, input)),
});

vi.spyOn(console, "error").mockReturnValue();

const recall = async (item: EvalCase) => {
  const input = recallInputSchema.parse({
    cue: item.cue,
    ...(item.context && { context: item.context }),
  });
  const result = await recallWith(
    inMemory(corpus, { settings: { relevanceFilter: strictness } }),
    input,
    jev(ai)
  );
  return {
    failed: result.warnings !== undefined,
    refs: result.fragments.map((fragment) => fragment.ref),
  };
};

const pool = async <T, R>(items: T[], task: (item: T) => Promise<R>) => {
  const results: R[] = Array.from({ length: items.length });
  const queue = items.entries();
  const worker = async () => {
    for (const [index, item] of queue) {
      // oxlint-disable-next-line no-await-in-loop
      results[index] = await task(item);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
};

it("scores recall on the evaluation set", async () => {
  const results = await pool(cases, async (item) => ({
    ...(await recall(item)),
    case: item,
  }));
  const run: Run = {
    failures: results.filter((result) => result.failed).length,
    name: `jev ${strictness}`,
    outcomes: results.map(({ case: item, refs }): Outcome => ({
      case: item,
      refs,
    })),
  };
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf-8",
  }).trim();
  const header = `# Recall evaluation

${fragments.length} fragments, ${cases.length} cues, at most 10 results. Commit \`${commit}\`; Jev strictness \`${strictness}\`. Regenerate with \`pnpm eval\` (it bills Workers AI).`;
  const markdown = report([run], header);
  writeFileSync(path.join(import.meta.dirname, "results.md"), markdown);
  process.stdout.write(`${markdown}\n`);
});
