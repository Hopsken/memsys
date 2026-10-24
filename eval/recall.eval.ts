import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { z } from "zod";

import type { Fragment } from "../contract/memory";
import type { Json } from "../contract/plugin";
import { inputs } from "../core/inputs";
import { plugins } from "../plugins";
import { resolvePlugins } from "../worker/plugin-host";
import type { PluginEnv, StoredConfig } from "../worker/plugin-host";
import { runRecall } from "../worker/recall/host";
import { pipeline } from "../worker/recall/pipeline";
import { cases, fragments } from "./dataset";
import type { EvalCase } from "./dataset";
import { report } from "./metrics";
import type { Outcome, Run } from "./metrics";

// JEV=1 adds setups that call Workers AI and bill the account.
const withJev = process.env["JEV"] === "1";
const strictness = process.env["JEV_STRICTNESS"] ?? "medium";
const CONCURRENCY = 4;

const corpus = new Map<string, Fragment>(
  fragments.map(({ date, fragment, id }) => [
    id,
    { at: `${date}T12:00:00.000Z`, fragment, ref: id },
  ])
);

const row = (name: string, enabled: boolean, config: Json = {}) =>
  ({ config, enabled, name, updatedAt: 0 }) satisfies StoredConfig;

const setups: { name: string; stored: StoredConfig[]; jev?: boolean }[] = [
  { name: "core", stored: [row("idf", false)] },
  { name: "idf", stored: [] },
  {
    jev: true,
    name: "idf+jev",
    stored: [row("jev", true, { strictness })],
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

const env: PluginEnv = {
  ai: {
    run: async (model, input) => {
      if (!proxy) {
        throw new Error("Workers AI is off; set JEV=1");
      }
      // SAFETY: the binding's model union has no entry for Jev; the output is
      // parsed as JSON before plugins see it, as in MemoryDO.
      return z.json().parse(await proxy.env.AI.run(model as never, input));
    },
  },
  corpus,
};

// Jev retries and logs each failed attempt itself.
vi.spyOn(console, "error").mockReturnValue();

// A failed recall scores as returning nothing.
const recall = async (stored: StoredConfig[], item: EvalCase) => {
  const input = inputs.recall.parse({
    cue: item.cue,
    ...(item.context && { context: item.context }),
  });
  const result = await runRecall(
    pipeline,
    resolvePlugins(plugins, stored),
    env,
    input
  );
  return "error" in result
    ? { failed: true, refs: [] }
    : {
        failed: false,
        refs: result.fragments.map((fragment) => fragment.ref),
      };
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
      ...(await recall(setup.stored, item)),
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
