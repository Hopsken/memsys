import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Fragment, RecallItem } from "../contract/memory";
import { definePlugin, PluginAbortError } from "../contract/plugin";
import type { Json, Plugin, Verdict } from "../contract/plugin";
import { plugins } from "../plugins";
import { idf } from "../plugins/idf";
import { listTags } from "../plugins/list-tags";
import { sizeLimit } from "../plugins/size-limit";
import {
  assertRegistry,
  createCtx,
  resolvePlugins,
  runAfterRecall,
  runVerdicts,
} from "../worker/plugin-host";
import type { PluginState, StoredConfig } from "../worker/plugin-host";

const corpus = new Map<string, Fragment>(
  [
    ["a", "First #Zeta #PROJECT/One"],
    ["b", "Second #zeta #记忆"],
  ].map(([ref = "", fragment = ""]) => [
    ref,
    { createdAt: "", fragment, ref, updatedAt: "" },
  ])
);

const offline = { run: () => Promise.reject(new Error("offline")) };
const env = { ai: offline, corpus };

const stub = (name: string, hook: () => Promise<Verdict>) =>
  definePlugin({
    beforeRemember: hook,
    config: z.object({}),
    defaults: { config: {}, enabled: true },
    description: "",
    name,
    title: name,
  });

const reorder = (
  name: string,
  hook: (items: readonly RecallItem[]) => Promise<RecallItem[]>
) =>
  definePlugin({
    afterRecall: (_ctx, items) => hook(items),
    config: z.object({}),
    defaults: { config: {}, enabled: true },
    description: "",
    name,
    title: name,
  });

const recallRow = (ref: string, fragment: string, via?: string[]) => ({
  createdAt: "",
  fragment,
  ref,
  updatedAt: "",
  ...(via && { via }),
});

const recallInput = { associate: true, context: null, cue: "x", limit: 20 };
const refs = (result: RecallItem[] | { error: string }) =>
  "error" in result ? result : result.map((item) => item.ref);

const state = (plugin: Plugin<Json>, enabled = true): PluginState => ({
  config: plugin.defaults.config,
  enabled,
  plugin,
  status: "default",
  updatedAt: null,
});

const resolve = (...stored: StoredConfig[]) =>
  resolvePlugins([sizeLimit], stored).map(({ config, enabled, status }) => ({
    config,
    enabled,
    status,
  }))[0];

const verdict =
  (warnings: string[], rejections: string[] = []) =>
  () =>
    Promise.resolve({ rejections, warnings });

describe("size-limit plugin", () => {
  it("counts grapheme clusters against the default limits", async () => {
    // Six graphemes; UTF-16 units and code points give different lengths.
    const unit = "中a👍🏽👨‍👩‍👧‍👦é🇨🇳";
    const text = (length: number) =>
      unit.repeat(Math.floor(length / 6)) + "文".repeat(length % 6);
    const ctx = createCtx(sizeLimit.defaults.config, env);
    const results = await Promise.all(
      [300, 301, 500, 501].map(async (length) => {
        const result = await sizeLimit.beforeRemember?.(ctx, text(length));
        return [result?.warnings.length, result?.rejections.length];
      })
    );
    expect(results).toStrictEqual([
      [0, 0],
      [1, 0],
      [1, 0],
      [0, 1],
    ]);
  });

  it("rejects configs with soft above hard or beyond the core ceiling", () => {
    expect(
      [
        { hard: 500, soft: 300 },
        { hard: 300, soft: 500 },
        { hard: 1001, soft: 300 },
      ].map((config) => sizeLimit.config.safeParse(config).success)
    ).toStrictEqual([true, false, false]);
  });
});

describe("idf plugin", () => {
  it("ranks associations by summed anchor rarity and keeps matches first", async () => {
    const rows = [
      recallRow("m", "Match #hub #rare"),
      recallRow("h1", "Hub only #hub", ["hub"]),
      recallRow("h2", "Hub only #hub", ["hub"]),
      recallRow("r", "Rare link #hub #rare", ["hub", "rare"]),
    ];
    const ranked = await idf.afterRecall?.(
      createCtx(
        {},
        {
          ai: offline,
          corpus: new Map(rows.map((item) => [item.ref, item])),
        }
      ),
      rows,
      recallInput
    );
    expect(ranked?.map((item) => item.ref)).toStrictEqual([
      "m",
      "r",
      "h1",
      "h2",
    ]);
  });
});

describe("list-tags plugin", () => {
  it("lists unique lowercase anchors", async () => {
    const [tool] = listTags.tools ?? [];
    await expect(tool?.run(createCtx({}, env), {})).resolves.toStrictEqual([
      "project/one",
      "zeta",
      "记忆",
    ]);
  });
});

describe("Plugin host", () => {
  it("aggregates every warning and rejection from enabled plugins", async () => {
    const result = await runVerdicts(
      [
        state(stub("a", verdict(["wa"], ["ra"]))),
        state(stub("b", verdict(["wb"], ["rb"]))),
        state(stub("off", verdict(["woff"], ["roff"])), false),
      ],
      env,
      (plugin, ctx) => plugin.beforeRemember?.(ctx, "text")
    );
    expect(result).toStrictEqual({
      rejections: ["ra", "rb"],
      warnings: ["wa", "wb"],
    });
  });

  it("skips failing hooks and names the plugin on abort", async () => {
    const log = vi.spyOn(console, "error").mockReturnValue();
    const result = await runVerdicts(
      [
        state(stub("broken", () => Promise.reject(new Error("bug")))),
        state(
          stub("guard", () =>
            Promise.reject(new PluginAbortError("unsafe input"))
          )
        ),
        state(stub("ok", verdict(["fine"]))),
      ],
      env,
      (plugin, ctx) => plugin.beforeRemember?.(ctx, "text")
    );
    expect(result).toStrictEqual({
      rejections: ["guard: unsafe input"],
      warnings: ["fine"],
    });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("chains afterRecall hooks in registry order and ignores foreign items", async () => {
    const items = [...corpus.values()];
    const result = await runAfterRecall(
      [
        state(reorder("reverse", (rows) => Promise.resolve(rows.toReversed()))),
        state(
          reorder("invent", (rows) =>
            Promise.resolve([
              ...rows.map((row) => ({ ...row, fragment: "rewritten" })),
              { createdAt: "", fragment: "fake", ref: "zz", updatedAt: "" },
            ])
          )
        ),
        state(
          reorder("off", () => Promise.resolve([])),
          false
        ),
      ],
      env,
      items,
      recallInput
    );
    expect(result).toStrictEqual(items.toReversed());
  });

  it("passes input through failing afterRecall hooks and stops on abort", async () => {
    const log = vi.spyOn(console, "error").mockReturnValue();
    const items = [...corpus.values()];
    const broken = state(
      reorder("broken", () => Promise.reject(new Error("bug")))
    );
    const guard = state(
      reorder("guard", () => Promise.reject(new PluginAbortError("unsafe cue")))
    );
    await expect(
      runAfterRecall([broken], env, items, recallInput).then(refs)
    ).resolves.toStrictEqual(["a", "b"]);
    await expect(
      runAfterRecall([guard, broken], env, items, recallInput)
    ).resolves.toStrictEqual({ error: "guard: unsafe cue" });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("falls back to defaults when a stored config no longer parses", () => {
    const log = vi.spyOn(console, "error").mockReturnValue();
    const row = { name: "size-limit", updatedAt: 1 };
    const invalid = resolve({
      ...row,
      config: { hard: 1, soft: 2 },
      enabled: false,
    });
    const custom = resolve({
      ...row,
      config: { hard: 20, soft: 10 },
      enabled: true,
    });
    const fallback = resolve();
    expect({ custom, fallback, invalid }).toStrictEqual({
      custom: {
        config: { hard: 20, soft: 10 },
        enabled: true,
        status: "custom",
      },
      fallback: {
        config: { hard: 500, soft: 300 },
        enabled: true,
        status: "default",
      },
      invalid: {
        config: { hard: 500, soft: 300 },
        enabled: false,
        status: "invalid",
      },
    });
    log.mockRestore();
  });

  it("keeps tool plugins additive", () => {
    const shadow = definePlugin({
      ...listTags,
      name: "shadow",
      tools: [
        {
          description: "",
          input: z.object({}),
          name: "recall",
          run: () => Promise.resolve(null),
        },
      ],
    });
    expect(() => assertRegistry(plugins)).not.toThrow();
    expect(() => assertRegistry([listTags, shadow])).toThrow(
      "Plugin shadow redefines tool recall"
    );
    expect(() => assertRegistry([listTags, listTags])).toThrow(
      "Duplicate plugin name: list-tags"
    );
  });
});
