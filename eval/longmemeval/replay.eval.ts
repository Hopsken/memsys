// Replays a run's answer-time recalls against its saved memory, with no
// agent: each recorded cue goes through core recall and the plugins of each
// setup. Measures what the plugins drop, and which needed memories they
// drop with it. Costs nothing without Jev; with it, bills Workers AI.
//
//   RUN=baseline-1021 pnpm exec vitest run --config eval/longmemeval/vitest.config.ts
//
// JEV_STRICTNESS (default medium) sets the Jev level. Writes
// runs/<run>/replay-<strictness>.md.

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { z } from "zod";

import type { Fragment, RecallItem } from "../../contract/memory";
import type { Json } from "../../contract/plugin";
import { plugins } from "../../plugins";
import { JEV_TIMEOUT_MS } from "../../plugins/jev";
import { inputs, recallCandidates, truncate } from "../../worker/memory";
import { resolvePlugins, runAfterRecall } from "../../worker/plugin-host";
import type { PluginEnv, StoredConfig } from "../../worker/plugin-host";
import { piRun } from "./pi.ts";
import { verdict } from "./report.ts";

const RUN = process.env["RUN"] ?? "baseline-1021";
const RUN_DIR = path.join(import.meta.dirname, "runs", RUN);
const STRICTNESS = process.env["JEV_STRICTNESS"] ?? "medium";
// Jev fails open on its timeout; retry so results reflect its judgment.
const ATTEMPTS = 3;
const CONCURRENCY = 4;

const row = (name: string, enabled: boolean, config: Json = {}) =>
  ({ config, enabled, name, updatedAt: 0 }) satisfies StoredConfig;

// The first setup is what the run used: plugin defaults, idf on, Jev off.
const setups: { name: string; stored: StoredConfig[] }[] = [
  { name: "as run (idf)", stored: [] },
  {
    name: "idf + jev",
    stored: [row("jev", true, { matches: false, strictness: STRICTNESS })],
  },
  {
    name: "idf + jev (matches)",
    stored: [row("jev", true, { matches: true, strictness: STRICTNESS })],
  },
];

const proxy = await getPlatformProxy<{ AI: Ai }>({
  configPath: path.join(import.meta.dirname, "..", "wrangler.jsonc"),
  remoteBindings: true,
});
afterAll(async () => {
  await proxy.dispose();
});

const logRecord = z.looseObject({
  at: z.string(),
  fragment: z.string().nullable(),
  ref: z.string(),
});
const recalled = z.object({
  fragments: z.array(
    z.looseObject({ ref: z.string(), via: z.array(z.string()).optional() })
  ),
});

interface Cue {
  args: z.input<typeof inputs.recall>;
  // Refs the agent saw for this cue, in order.
  recorded: string[];
}

interface Case {
  corpus: Map<string, Fragment>;
  cues: Cue[];
  evidence: Set<string>;
  id: string;
}

const loadCase = async (id: string): Promise<Case> => {
  const dir = path.join(RUN_DIR, id);
  const corpus = new Map<string, Fragment>();
  const log = await readFile(path.join(dir, "memory.ndjson"), "utf-8");
  for (const line of log.split("\n").filter(Boolean)) {
    const { at, fragment, ref } = logRecord.parse(JSON.parse(line));
    if (fragment === null) {
      corpus.delete(ref);
    } else {
      corpus.set(ref, { at, fragment, ref });
    }
  }
  const answer = piRun.parse(
    JSON.parse(await readFile(path.join(dir, "answer.json"), "utf-8"))
  );
  const judged = verdict.parse(
    JSON.parse(await readFile(path.join(dir, "verdict.json"), "utf-8"))
  );
  const cues = answer.tools
    .filter((tool) => tool.name === "recall" && !tool.isError)
    .map((tool) => ({
      args: inputs.recall.parse(tool.args),
      recorded: recalled
        .parse(JSON.parse(tool.result))
        .fragments.map((item) => item.ref),
    }));
  return { corpus, cues, evidence: new Set(judged.evidence), id };
};

// One recall. `failed` is true when Jev was asked and the hook gave up
// before its answer arrived, so the input passed through unjudged.
const recallOnce = async (
  stored: StoredConfig[],
  item: Case,
  cue: Cue
): Promise<{ failed: boolean; items: RecallItem[]; ms: number }> => {
  let called = false;
  let answered = false;
  const env: PluginEnv = {
    ai: {
      run: async (model, input) => {
        called = true;
        // SAFETY: the binding's model union has no entry for Jev; the output
        // is parsed as JSON before plugins see it, as in MemoryDO.
        const output = await proxy.env.AI.run(model as never, input);
        answered = true;
        return z.json().parse(output);
      },
    },
    corpus: item.corpus,
  };
  const { candidates, input } = recallCandidates(
    item.corpus.values(),
    cue.args
  );
  const start = Date.now();
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
    failed: called && !answered,
    items: truncate(ranked, input.limit).fragments,
    ms: Date.now() - start,
  };
};

const recall = async (stored: StoredConfig[], item: Case, cue: Cue) => {
  let result = await recallOnce(stored, item, cue);
  for (let attempt = 1; result.failed && attempt < ATTEMPTS; attempt += 1) {
    // Retries are sequential by design.
    // oxlint-disable-next-line no-await-in-loop
    result = await recallOnce(stored, item, cue);
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

const table = (head: string[], rows: (string | number)[][]) =>
  [head, head.map(() => "---"), ...rows]
    .map((cells) => `| ${cells.join(" | ")} |`)
    .join("\n");

it("replays recorded recalls under each plugin setup", async () => {
  const entries = await readdir(RUN_DIR);
  const ids = entries.filter((id) =>
    existsSync(path.join(RUN_DIR, id, "verdict.json"))
  );
  const cases = await Promise.all(ids.toSorted().map(loadCase));
  const jobs = cases.flatMap((item) => item.cues.map((cue) => ({ cue, item })));

  const rows: (string | number)[][] = [];
  const lost: string[] = [];
  let baseline: Map<string, Set<string>> | null = null;
  let reproduced = 0;
  for (const setup of setups) {
    // Setups run one after another so their Jev load does not mix.
    // oxlint-disable-next-line no-await-in-loop
    const results = await pool(jobs, async ({ cue, item }) => ({
      ...(await recall(setup.stored, item, cue)),
      cue,
      item,
    }));
    const returned = results.flatMap((result) => result.items);
    // Needed memories some recall returned, per question.
    const found = new Map<string, Set<string>>();
    for (const { item, items } of results) {
      const set = found.get(item.id) ?? new Set<string>();
      for (const fragment of items) {
        if (item.evidence.has(fragment.ref)) {
          set.add(fragment.ref);
        }
      }
      found.set(item.id, set);
    }
    if (baseline === null) {
      baseline = found;
      reproduced = results.filter(
        ({ cue, items }) =>
          items.map((fragment) => fragment.ref).join(",") ===
          cue.recorded.join(",")
      ).length;
    }
    for (const [id, refs] of baseline) {
      for (const ref of refs) {
        if (!found.get(id)?.has(ref)) {
          lost.push(`${setup.name}: ${id} ${ref}`);
        }
      }
    }
    const ms = results.map((result) => result.ms).toSorted((a, b) => a - b);
    rows.push([
      setup.name,
      returned.length,
      returned.filter((fragment) => fragment.via).length,
      results.filter((result) => result.items.length === 0).length,
      [...found.values()].reduce((sum, refs) => sum + refs.size, 0),
      results.filter((result) => result.failed).length,
      ms[Math.floor(ms.length / 2)] ?? 0,
      ms[Math.floor(ms.length * 0.95)] ?? 0,
    ]);
  }
  const markdown = `# Recall replay, run \`${RUN}\`

${jobs.length} answer-time recalls from ${cases.length} questions, replayed against each question's saved memory. \`as run\` reproduced the recorded result exactly for ${reproduced} of ${jobs.length} recalls. Jev at strictness \`${STRICTNESS}\`, timeout ${JEV_TIMEOUT_MS} ms, up to ${ATTEMPTS} attempts. Regenerate with \`RUN=${RUN} JEV_STRICTNESS=${STRICTNESS} pnpm exec vitest run --config eval/longmemeval/vitest.config.ts\`.

Evidence found counts needed memories (as labeled for the run) that at least one recall of the question returned.

${table(
  [
    "Setup",
    "Returned",
    "Via anchors",
    "Empty recalls",
    "Evidence found",
    "Jev failures",
    "Median ms",
    "p95 ms",
  ],
  rows
)}

## Evidence lost against \`as run\`

${lost.length === 0 ? "None." : lost.map((entry) => `- ${entry}`).join("\n")}
`;
  await writeFile(path.join(RUN_DIR, `replay-${STRICTNESS}.md`), markdown);
  process.stdout.write(`${markdown}\n`);
});
