import { inMemory } from "@core";
import type { Fragment } from "@core";
import { describe, expect, it } from "vitest";

import { terms } from "@lib/analyzer";
import { extractAnchors } from "@lib/anchor";
import { ok } from "@lib/result";

import {
  recall as recallWith,
  recallInputSchema,
} from "../../worker/services/memory/recall";
import type { Judge } from "../../worker/services/memory/recall";

// These tests cover what recall finds; the filter keeps all of it.
const keepAll: Judge = (candidates) =>
  Promise.resolve(ok(new Map(candidates.map((item) => [item.ref, 1]))));

const recall = async (corpus: Iterable<Fragment>, raw: { cue: string }) => {
  const result = await recallWith(
    inMemory(corpus),
    recallInputSchema.parse({ cues: raw.cue }),
    keepAll
  );
  if (!result.ok) {
    throw new Error(result.error.reason);
  }
  return result.value;
};

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
  const { fragments } = await recall(corpus, { cue });
  return fragments.filter((row) => !row.via).map((row) => row.ref);
};

describe("Recall", () => {
  it("extracts normalized anchors without treating URLs, headings, or numbers as tags", () => {
    expect(
      extractAnchors(
        "#Cloudflare #cloudflare (#project/a) #agent-memory #a_b #记忆 #2fa PR #80 and #67-#70 https://x/#ignored word#ignored ##heading"
      )
    ).toStrictEqual([
      "2fa",
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
      truncated: false,
    });
    await expect(recall(corpus, { cue: "absent" })).resolves.toStrictEqual({
      fragments: [],
      truncated: false,
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

  it("matches cue words in any order or inflection, fuller matches first", async () => {
    const corpus = [
      item("a", "D1's primary region is in US West #d1"),
      item("b", "Evicted objects rebuild from SQLite"),
      item("c", "Region only"),
    ];
    await expect(matched(corpus, "d1 region")).resolves.toStrictEqual([
      "a",
      "c",
    ]);
    await expect(matched(corpus, "eviction object")).resolves.toStrictEqual([
      "b",
    ]);
    await expect(matched(corpus, "west region D1")).resolves.toStrictEqual([
      "a",
      "c",
    ]);
  });

  it("matches a fragment that shares any one cue word", async () => {
    const corpus = [
      item("one", "Vite config", "03"),
      item("two", "Vite error on start", "02"),
      item("none", "Unrelated note", "01"),
    ];
    await expect(matched(corpus, "vite error crash")).resolves.toStrictEqual([
      "two",
      "one",
    ]);
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
    await expect(
      matched(
        [
          item("common", "alpha beta", "02"),
          item("rare", "alpha gamma", "01"),
          ...["x", "y", "z"].map((ref) => item(ref, "beta")),
        ],
        "alpha beta gamma"
      )
    ).resolves.toStrictEqual(["rare", "common", "x", "y", "z"]);
  });

  it("finds nothing for a cue of only stopwords (RFC 0004)", async () => {
    const corpus = [item("a", "To be or not to be"), item("b", "Or else")];
    await expect(matched(corpus, "to be")).resolves.toStrictEqual([]);
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

  it("puts matches before associations, newest association first", async () => {
    const corpus = [
      item("neighbor", "neighbor #shared"),
      item("newest", "newest neighbor #shared", "02"),
      ...["m-02", "m-01", "m-00"].map((ref) => item(ref, "cue #shared")),
    ];
    const { fragments, truncated } = await recall(corpus, { cue: "cue" });
    expect({
      refs: fragments.map((row) => row.ref),
      truncated,
    }).toStrictEqual({
      refs: ["m-00", "m-01", "m-02", "newest", "neighbor"],
      truncated: false,
    });
  });

  it("ranks an old association through a rare anchor above many newer ones through a common anchor", async () => {
    const corpus = [
      item("seed", "cue #rare #common", "01"),
      item("old-rare", "old #rare", "01"),
      ...Array.from({ length: 150 }, (_, index) =>
        item(`new-${index}`, "new #common", "02")
      ),
    ];
    const [first] = await associated(corpus, "cue");
    expect(first?.ref).toBe("old-rare");
  });

  it.each([
    [10, 0, false],
    [11, 0, true],
    [9, 2, false],
  ])(
    "returns ten of %i matches and %i associations, truncated: %s",
    async (matches, neighbors, truncated) => {
      const corpus = [
        ...Array.from({ length: matches }, (_, index) =>
          item(`m-${index}`, "cue #shared")
        ),
        ...Array.from({ length: neighbors }, (_, index) =>
          item(`n-${index}`, "neighbor #shared")
        ),
      ];
      const result = await recall(corpus, { cue: "cue" });
      expect({
        returned: result.fragments.length,
        truncated: result.truncated,
      }).toStrictEqual({
        returned: Math.min(matches + neighbors, 10),
        truncated,
      });
    }
  );
});
