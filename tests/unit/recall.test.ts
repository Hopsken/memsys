import { describe, expect, it } from "vitest";

import type { Fragment } from "../../contract/memory";
import { extractAnchors } from "../../lib/anchor";
import { RECALL_LIMIT_MAX } from "../../lib/recall";
import { terms } from "../../worker/recall/match";
import { recall } from "../../worker/recall/pipeline";

const item = (ref: string, fragment: string, day = "01"): Fragment => ({
  at: `2026-01-${day}T00:00:00.000Z`,
  fragment,
  ref,
});

const associated = async (corpus: Fragment[], cue: string) => {
  const { fragments } = await recall(corpus, { cue });
  return fragments.filter((row) => row.via);
};

const matched = async (corpus: Fragment[], cue: string) => {
  const { fragments } = await recall(corpus, { associate: false, cue });
  return fragments.map((row) => row.ref);
};

describe("Recall", () => {
  it("extracts normalized anchors without treating URLs or headings as tags", () => {
    expect(
      extractAnchors(
        "#Cloudflare #cloudflare (#project/a) #agent-memory #a_b #记忆 #123 https://x/#ignored word#ignored ##heading"
      )
    ).toStrictEqual([
      "123",
      "a_b",
      "agent-memory",
      "cloudflare",
      "project/a",
      "记忆",
    ]);
  });

  it("matches cue words and follows one hop of associations without duplicate results", async () => {
    const corpus = [
      item("a", "Durable\n  Objects #Project/A #shared"),
      item("b", "Related #project/a #shared #next"),
      item("c", "Not a namespace match #project/ab"),
      item("d", "Not transitive #next"),
      item("e", "Objects are durable #unrelated"),
    ];
    await expect(
      recall(corpus, { cue: " DURABLE objects " })
    ).resolves.toStrictEqual({
      fragments: [
        corpus[0],
        corpus[4],
        { ...corpus[1], via: ["project/a", "shared"] },
      ],
      hasMore: false,
    });
    await expect(recall(corpus, { cue: "absent" })).resolves.toStrictEqual({
      fragments: [],
      hasMore: false,
    });
  });

  it("stems both sides of English associations while preserving returned anchors", async () => {
    const corpus = [
      item("a", "Seed #PROGRAMMING #relational"),
      item("b", "Neighbor #program #programs #relation #next"),
      item("c", "Not transitive #next"),
      item("d", "Not an anchor: program relation"),
      item("e", "Different stem #programmer"),
    ];
    const { fragments } = await recall(corpus, { cue: "Seed" });
    expect(fragments).toStrictEqual([
      corpus[0],
      { ...corpus[1], via: ["program", "programs", "relation"] },
    ]);
    await expect(associated(corpus, "Neighbor")).resolves.toContainEqual({
      ...corpus[0],
      via: ["programming", "relational"],
    });
  });

  it("tokenizes words and anchor parts, dropping possessives and stopwords", () => {
    expect(
      terms("The DOs got evicted; D1's #Durable-Objects in integrity_check")
    ).toStrictEqual([
      "dos",
      "got",
      "evict",
      "d1",
      "durabl",
      "object",
      "integrity_check",
    ]);
    expect(terms("the of and")).toStrictEqual([]);
  });

  it("matches every cue word in any order or inflection", async () => {
    const corpus = [
      item("a", "D1's primary region is in US West #d1"),
      item("b", "Evicted objects rebuild from SQLite"),
      item("c", "Region only"),
    ];
    await expect(matched(corpus, "d1 region")).resolves.toStrictEqual(["a"]);
    await expect(matched(corpus, "eviction object")).resolves.toStrictEqual([
      "b",
    ]);
    await expect(matched(corpus, "west region D1")).resolves.toStrictEqual([
      "a",
    ]);
  });

  it("lets a cue of three or more words miss one word, and no more", async () => {
    const corpus = [item("a", "Vite dev server returns 403")];
    await expect(matched(corpus, "vite 403 error")).resolves.toStrictEqual([
      "a",
    ]);
    await expect(matched(corpus, "vite error")).resolves.toStrictEqual([]);
    await expect(matched(corpus, "vite bug error")).resolves.toStrictEqual([]);
  });

  it("ranks phrase matches first, then by words matched, then by BM25", async () => {
    await expect(
      matched(
        [
          item("words", "server dev vite", "03"),
          item("phrase", "vite dev server", "01"),
          item("partial", "vite server", "02"),
        ],
        "vite dev server"
      )
    ).resolves.toStrictEqual(["phrase", "words", "partial"]);
    // gamma is rarer than beta, so it weighs more.
    await expect(
      matched(
        [
          item("common", "alpha beta", "02"),
          item("rare", "alpha gamma", "01"),
          ...["x", "y", "z"].map((ref) => item(ref, "beta")),
        ],
        "alpha beta gamma"
      )
    ).resolves.toStrictEqual(["rare", "common"]);
  });

  it("falls back to phrase matching when the cue has only stopwords", async () => {
    const corpus = [item("a", "To be or not to be"), item("b", "Or else")];
    await expect(matched(corpus, "to be")).resolves.toStrictEqual(["a"]);
  });

  it.each([
    ["agents", "agent-memory"],
    ["memory", "agent-memory"],
    ["agents-memories", "memory-storage"],
    ["记忆", "agent-记忆"],
  ])("associates #%s and #%s in both directions", async (left, right) => {
    const corpus = [item("a", `Left #${left}`), item("b", `Right #${right}`)];
    await expect(associated(corpus, "Left")).resolves.toStrictEqual([
      { ...corpus[1], via: [right] },
    ]);
    await expect(associated(corpus, "Right")).resolves.toStrictEqual([
      { ...corpus[0], via: [left] },
    ]);
  });

  it("matches whole tokens without empty-token or transitive associations", async () => {
    const corpus = [
      item("a", "Seed #agents--memories-"),
      item("b", "Related #agent-memory #agent-tools"),
      item("c", "Not transitive #tools"),
      item("d", "Not a whole token #agency #memoryful"),
      item("e", "Not an empty token #-unrelated"),
      item("f", "Not an anchor: agent memory"),
      item("g", "Namespace #project/agent-memory #agents-memories/archive"),
    ];
    await expect(associated(corpus, "Seed")).resolves.toStrictEqual([
      { ...corpus[1], via: ["agent-memory", "agent-tools"] },
    ]);
    await expect(associated(corpus, "Namespace")).resolves.toStrictEqual([]);
  });

  it("keeps namespace, underscore, numeric, and Unicode anchors exact", async () => {
    const anchors = [
      "project/programs",
      "project/agent-programs",
      "a_programs",
      "123s",
      "记忆s",
    ];
    const corpus = [
      item("a", `Seed ${anchors.map((anchor) => `#${anchor}`).join(" ")}`),
      item(
        "b",
        "Different #project/program #project/agent-program #a_program #123 #记忆"
      ),
      item("c", `Exact ${anchors.map((anchor) => `#${anchor}`).join(" ")}`),
    ];
    await expect(associated(corpus, "Seed")).resolves.toStrictEqual([
      { ...corpus[2], via: anchors.toSorted() },
    ]);
  });

  it.each([
    [undefined, ["m-00", "m-01", "m-02", "newest", "neighbor"], false],
    [5, ["m-00", "m-01", "m-02", "newest", "neighbor"], false],
    [4, ["m-00", "m-01", "m-02", "newest"], true],
    [3, ["m-00", "m-01", "m-02"], true],
    [2, ["m-00", "m-01"], true],
  ])(
    "puts matches before associations and bounds the combined list to %s",
    async (limit, refs, hasMore) => {
      const corpus = [
        item("neighbor", "neighbor #shared"),
        item("newest", "newest neighbor #shared", "02"),
        ...["m-02", "m-01", "m-00"].map((ref) => item(ref, "cue #shared")),
      ];
      const result = await recall(corpus, {
        cue: "cue",
        ...(limit && { limit }),
      });
      expect({
        hasMore: result.hasMore,
        refs: result.fragments.map((row) => row.ref),
      }).toStrictEqual({ hasMore, refs });
    }
  );

  it("caps limit at the maximum and warns", async () => {
    const corpus = Array.from({ length: RECALL_LIMIT_MAX + 5 }, (_, index) =>
      item(`m-${index}`, "cue")
    );
    const result = await recall(corpus, { cue: "cue", limit: 100 });
    expect(result.fragments).toHaveLength(RECALL_LIMIT_MAX);
    expect(result.hasMore).toBeTruthy();
    expect(result.warnings).toStrictEqual([
      `limit 100 is above the maximum of ${RECALL_LIMIT_MAX}; returned at most ${RECALL_LIMIT_MAX} fragments.`,
    ]);
    await expect(
      recall(corpus, { cue: "cue", limit: RECALL_LIMIT_MAX })
    ).resolves.not.toHaveProperty("warnings");
  });

  it("skips association when disabled", async () => {
    const corpus = [item("a", "cue #shared"), item("b", "neighbor #shared")];
    await expect(
      recall(corpus, { associate: false, cue: "cue" })
    ).resolves.toStrictEqual({
      fragments: [corpus[0]],
      hasMore: false,
    });
  });

  it("returns 10 results by default", async () => {
    const corpus = Array.from({ length: 11 }, (_, index) =>
      item(`m-${index.toString().padStart(2, "0")}`, "cue")
    );
    const { fragments } = await recall(corpus, { cue: "cue" });
    expect(fragments).toHaveLength(10);
  });
});
