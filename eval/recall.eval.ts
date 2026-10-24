import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { inMemory } from "@core";
import { afterAll, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { z } from "zod";

import type { Fragment, JsonObject } from "@contract/memory";

import { jev } from "../worker/clients/jev";
import type { Ai } from "../worker/clients/jev";
import { recall as runRecall, recallInput } from "../worker/services/recall";
import { cases, fragments } from "./dataset";
import type { EvalCase } from "./dataset";
import { report } from "./metrics";
import type { Outcome, Run } from "./metrics";

// JEV=1 adds setups that call Workers AI and bill the account.
const withJev = process.env["JEV"] === "1";
const strictness = process.env["JEV_STRICTNESS"] ?? "medium";
const CONCURRENCY = 4;

const corpus: Fragment[] = fragments.map(({ date, fragment, id }) => ({
  at: `${date}T12:00:00.000Z`,
  fragment,
  ref: id,
}));

// The settings each setup changes from the defaults.
const setups: { name: string; settings: JsonObject; jev?: boolean }[] = [
  { name: "idf", settings: {} },
  {
    jev: true,
    name: "idf+jev",
    // Fails the run on an unknown level.
    settings: {
      relevanceFilter: z
        .enum(["low", "medium", "high", "max"])
        .parse(strictness),
    },
  },
];

const proxy = withJev
  ? await getPlatformProxy<{ AI: Ai }>({
      configPath: path.join(import.meta.dirname, "wrangler.jsonc"),
      remoteBindings: true,
    })
  : null;

afterAll(async () => {
  await proxy?.dispose();
});

const ai: Ai = {
  run: async (model, input) => {
    if (!proxy) {
      throw new Error("Workers AI is off; set JEV=1");
    }
    // SAFETY: the binding's model union has no entry for Jev; the output is
    // parsed as JSON before Jev sees it, as in MemoryDO.
    return z.json().parse(await proxy.env.AI.run(model as never, input));
  },
};

// Jev retries and logs each failed attempt itself.
vi.spyOn(console, "error").mockReturnValue();

// A failed recall scores as returning nothing.
const recall = async (settings: JsonObject, item: EvalCase) => {
  const input = recallInput.parse({
    cue: item.cue,
    ...(item.context && { context: item.context }),
  });
  const result = await runRecall(
    {
      judge: jev(ai),
      memory: inMemory(corpus, { settings }),
    },
    input
  );
  return result.ok
    ? {
        failed: false,
        refs: result.value.fragments.map((fragment) => fragment.ref),
      }
    : { failed: true, refs: [] };
};

const pool = async <T, R>(items: T[], task: (item: T) => Promise<R>) => {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      // SAFETY: index < items.length, checked by the loop condition.
      // oxlint-disable-next-line no-await-in-loop
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
};

it("scores recall on the evaluation set", async () => {
  const runs: Run[] = [];
  for (const setup of setups.filter((item) => withJev || !item.jev)) {
    // oxlint-disable-next-line no-await-in-loop
    const results = await pool(cases, async (item) => ({
      ...(await recall(setup.settings, item)),
      case: item,
    }));
    runs.push({
      failures: results.filter((result) => result.failed).length,
      name: setup.name,
      outcomes: results.map(({ case: item, refs }): Outcome => ({
        case: item,
        refs,
      })),
    });
  }
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf-8",
  }).trim();
  const header = `# Recall evaluation

${fragments.length} fragments, ${cases.length} cues, at most 10 results. Commit \`${commit}\`${withJev ? `; Jev strictness \`${strictness}\`` : "; Jev not run"}. Regenerate with \`pnpm eval\` (\`JEV=1 pnpm eval\` for Jev; it bills Workers AI).`;
  const markdown = report(runs, header);
  writeFileSync(path.join(import.meta.dirname, "results.md"), markdown);
  process.stdout.write(`${markdown}\n`);
});
