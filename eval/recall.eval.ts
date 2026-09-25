import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { z } from "zod";

import type { Fragment } from "../contract/memory";
import type { Json } from "../contract/plugin";
import { plugins } from "../plugins";
import { recallCandidates, truncate } from "../worker/memory";
import { resolvePlugins, runAfterRecall } from "../worker/plugin-host";
import type { PluginEnv, StoredConfig } from "../worker/plugin-host";
import { cases, fragments } from "./dataset";
import type { EvalCase } from "./dataset";
import { report } from "./metrics";
import type { Outcome, Run } from "./metrics";

// JEV=1 adds setups that call Workers AI and bill the account.
const withJev = process.env["JEV"] === "1";
const strictness = process.env["JEV_STRICTNESS"] ?? "medium";
// Jev fails open on its 1.5 s timeout; retry so scores reflect its judgment.
const ATTEMPTS = 3;
const CONCURRENCY = 4;

const corpus = new Map<string, Fragment>(
  fragments.map(({ date, fragment, id }) => [
    id,
    {
      createdAt: `${date}T12:00:00.000Z`,
      fragment,
      ref: id,
      updatedAt: `${date}T12:00:00.000Z`,
    },
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
    stored: [row("jev", true, { matches: false, strictness })],
  },
  {
    jev: true,
    name: "idf+jev(matches)",
    stored: [row("jev", true, { matches: true, strictness })],
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

const errors = vi.spyOn(console, "error").mockReturnValue();
const hookFailures = () =>
  errors.mock.calls.filter(
    ([entry]) =>
      z.object({ event: z.literal("plugin.hook.failed") }).safeParse(entry)
        .success
  ).length;

const recallOnce = async (stored: StoredConfig[], item: EvalCase) => {
  const { candidates, input } = recallCandidates(corpus.values(), {
    cue: item.cue,
    ...(item.context && { context: item.context }),
  });
  const failed = hookFailures();
  const ranked = await runAfterRecall(
    resolvePlugins(plugins, stored),
    env,
    candidates,
    input
  );
  if ("error" in ranked) {
    throw new Error(ranked.error);
  }
  return {
    failed: hookFailures() > failed,
    refs: truncate(ranked, input.limit).fragments.map(
      (fragment) => fragment.ref
    ),
  };
};

const recall = async (stored: StoredConfig[], item: EvalCase) => {
  let result = await recallOnce(stored, item);
  for (let attempt = 1; result.failed && attempt < ATTEMPTS; attempt += 1) {
    // Retries are sequential by design.
    // oxlint-disable-next-line no-await-in-loop
    result = await recallOnce(stored, item);
  }
  return result;
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

${fragments.length} fragments, ${cases.length} cues, limit 10. Commit \`${commit}\`${withJev ? `; Jev strictness \`${strictness}\`` : "; Jev not run"}. Regenerate with \`pnpm eval\` (\`JEV=1 pnpm eval\` for Jev; it bills Workers AI).`;
  const markdown = report(runs, header);
  writeFileSync(path.join(import.meta.dirname, "results.md"), markdown);
  process.stdout.write(`${markdown}\n`);
});
