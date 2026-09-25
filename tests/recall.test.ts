import { describe, expect, it } from "vitest";

import type { Fragment } from "../contract/memory";
import { extractAnchors, recall } from "../worker/memory";
import { terms } from "../worker/search";

const item = (ref: string, fragment: string, day = "01"): Fragment => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  fragment,
  ref,
  updatedAt: `2026-01-${day}T00:00:00.000Z`,
});

const associated = (corpus: Fragment[], cue: string) =>
  recall(corpus, { cue }).fragments.filter((row) => row.via);

const matched = (corpus: Fragment[], cue: string) =>
  recall(corpus, { associate: false, cue }).fragments.map((row) => row.ref);

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

  it("matches cue words and follows one hop of associations without duplicate results", () => {
    const corpus = [
      item("a", "Durable\n  Objects #Project/A #shared"),
      item("b", "Related #project/a #shared #next"),
      item("c", "Not a namespace match #project/ab"),
      item("d", "Not transitive #next"),
      item("e", "Objects are durable #unrelated"),
    ];
    expect(recall(corpus, { cue: " DURABLE objects " })).toStrictEqual({
      fragments: [
        corpus[0],
        corpus[4],
        { ...corpus[1], via: ["project/a", "shared"] },
      ],
      hasMore: false,
    });
    expect(recall(corpus, { cue: "absent" })).toStrictEqual({
      fragments: [],
      hasMore: false,
    });
  });

  it("stems both sides of English associations while preserving returned anchors", () => {
    const corpus = [
      item("a", "Seed #PROGRAMMING #relational"),
      item("b", "Neighbor #program #programs #relation #next"),
      item("c", "Not transitive #next"),
      item("d", "Not an anchor: program relation"),
      item("e", "Different stem #programmer"),
    ];
    expect(recall(corpus, { cue: "Seed" }).fragments).toStrictEqual([
      corpus[0],
      { ...corpus[1], via: ["program", "programs", "relation"] },
    ]);
    expect(associated(corpus, "Neighbor")).toContainEqual({
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

  it("matches every cue word in any order or inflection", () => {
    const corpus = [
      item("a", "D1's primary region is in US West #d1"),
      item("b", "Evicted objects rebuild from SQLite"),
      item("c", "Region only"),
    ];
    expect(matched(corpus, "d1 region")).toStrictEqual(["a"]);
    expect(matched(corpus, "eviction object")).toStrictEqual(["b"]);
    expect(matched(corpus, "west region D1")).toStrictEqual(["a"]);
  });

  it("lets a cue of three or more words miss one word, and no more", () => {
    const corpus = [item("a", "Vite dev server returns 403")];
    expect(matched(corpus, "vite 403 error")).toStrictEqual(["a"]);
    expect(matched(corpus, "vite error")).toStrictEqual([]);
    expect(matched(corpus, "vite bug error")).toStrictEqual([]);
  });

  it("ranks phrase matches first, then by words matched, then by BM25", () => {
    expect(
      matched(
        [
          item("words", "server dev vite", "03"),
          item("phrase", "vite dev server", "01"),
          item("partial", "vite server", "02"),
        ],
        "vite dev server"
      )
    ).toStrictEqual(["phrase", "words", "partial"]);
    // gamma is rarer than beta, so it weighs more.
    expect(
      matched(
        [
          item("common", "alpha beta", "02"),
          item("rare", "alpha gamma", "01"),
          ...["x", "y", "z"].map((ref) => item(ref, "beta")),
        ],
        "alpha beta gamma"
      )
    ).toStrictEqual(["rare", "common"]);
  });

  it("falls back to phrase matching when the cue has only stopwords", () => {
    const corpus = [item("a", "To be or not to be"), item("b", "Or else")];
    expect(matched(corpus, "to be")).toStrictEqual(["a"]);
  });

  it.each([
    ["agents", "agent-memory"],
    ["memory", "agent-memory"],
    ["agents-memories", "memory-storage"],
    ["记忆", "agent-记忆"],
  ])("associates #%s and #%s in both directions", (left, right) => {
    const corpus = [item("a", `Left #${left}`), item("b", `Right #${right}`)];
    expect(associated(corpus, "Left")).toStrictEqual([
      { ...corpus[1], via: [right] },
    ]);
    expect(associated(corpus, "Right")).toStrictEqual([
      { ...corpus[0], via: [left] },
    ]);
  });

  it("matches whole tokens without empty-token or transitive associations", () => {
    const corpus = [
      item("a", "Seed #agents--memories-"),
      item("b", "Related #agent-memory #agent-tools"),
      item("c", "Not transitive #tools"),
      item("d", "Not a whole token #agency #memoryful"),
      item("e", "Not an empty token #-unrelated"),
      item("f", "Not an anchor: agent memory"),
      item("g", "Namespace #project/agent-memory #agents-memories/archive"),
    ];
    expect(associated(corpus, "Seed")).toStrictEqual([
      { ...corpus[1], via: ["agent-memory", "agent-tools"] },
    ]);
    expect(associated(corpus, "Namespace")).toStrictEqual([]);
  });

  it("keeps namespace, underscore, numeric, and Unicode anchors exact", () => {
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
    expect(associated(corpus, "Seed")).toStrictEqual([
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
    (limit, refs, hasMore) => {
      const corpus = [
        item("neighbor", "neighbor #shared"),
        item("newest", "newest neighbor #shared", "02"),
        ...["m-02", "m-01", "m-00"].map((ref) => item(ref, "cue #shared")),
      ];
      const result = recall(corpus, { cue: "cue", ...(limit && { limit }) });
      expect({
        hasMore: result.hasMore,
        refs: result.fragments.map((row) => row.ref),
      }).toStrictEqual({ hasMore, refs });
    }
  );

  it("skips association when disabled", () => {
    const corpus = [item("a", "cue #shared"), item("b", "neighbor #shared")];
    expect(recall(corpus, { associate: false, cue: "cue" })).toStrictEqual({
      fragments: [corpus[0]],
      hasMore: false,
    });
  });

  it("returns 10 results by default", () => {
    const corpus = Array.from({ length: 11 }, (_, index) =>
      item(`m-${index.toString().padStart(2, "0")}`, "cue")
    );
    expect(recall(corpus, { cue: "cue" }).fragments).toHaveLength(10);
  });
});
