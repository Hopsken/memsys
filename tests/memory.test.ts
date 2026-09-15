import { describe, expect, it } from "vitest";

import { extractAnchors, recall } from "../worker/memory";
import type { Fragment } from "../worker/memory";

const item = (ref: string, fragment: string, day = "01"): Fragment => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  fragment,
  ref,
  updatedAt: `2026-01-${day}T00:00:00.000Z`,
});

describe("Recall projections", () => {
  it("parses normalized, unique anchors with namespaces and Unicode", () => {
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

  it("uses phrase matching and one-hop associations without duplicate results", () => {
    const corpus = [
      item("a", "Durable\n  Objects #Project/A #shared"),
      item("b", "Related #project/a #shared #next"),
      item("c", "Not a namespace match #project/ab"),
      item("d", "Not transitive #next"),
      item("e", "Objects are durable #unrelated"),
    ];
    expect(recall(corpus, " DURABLE objects ")).toStrictEqual({
      associated: [{ ...corpus[1], sharedAnchors: ["project/a", "shared"] }],
      hasMoreAssociated: false,
      hasMoreRecalled: false,
      recalled: [{ ...corpus[0], anchors: ["project/a", "shared"] }],
    });
    expect(recall(corpus, "absent")).toMatchObject({
      associated: [],
      recalled: [],
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
    expect(recall(corpus, "Seed")).toStrictEqual({
      associated: [
        { ...corpus[1], sharedAnchors: ["program", "programs", "relation"] },
      ],
      hasMoreAssociated: false,
      hasMoreRecalled: false,
      recalled: [{ ...corpus[0], anchors: ["programming", "relational"] }],
    });
    expect(recall(corpus, "Neighbor").associated).toContainEqual({
      ...corpus[0],
      sharedAnchors: ["programming", "relational"],
    });
    expect(recall(corpus, "#programming").recalled).toStrictEqual([
      { ...corpus[0], anchors: ["programming", "relational"] },
    ]);
    expect(recall(corpus, "relations")).toMatchObject({
      associated: [],
      recalled: [],
    });
  });

  it("keeps structured, numeric, and Unicode anchors exact", () => {
    const anchors = [
      "project/programs",
      "agent-programs",
      "a_programs",
      "123s",
      "记忆s",
    ];
    const corpus = [
      item("a", `Seed ${anchors.map((anchor) => `#${anchor}`).join(" ")}`),
      item(
        "b",
        "Different #project/program #agent-program #a_program #123 #记忆"
      ),
      item("c", `Exact ${anchors.map((anchor) => `#${anchor}`).join(" ")}`),
    ];
    expect(recall(corpus, "Seed").associated).toStrictEqual([
      { ...corpus[2], sharedAnchors: anchors.toSorted() },
    ]);
  });

  it("bounds both lists, sorts deterministically, and expands only returned seeds", () => {
    const seeds = Array.from({ length: 21 }, (_, index) =>
      item(
        `seed-${index.toString().padStart(2, "0")}`,
        `cue #${index === 20 ? "hidden" : "shared"}`
      )
    );
    const neighbors = Array.from({ length: 21 }, (_, index) =>
      item(`neighbor-${index.toString().padStart(2, "0")}`, "neighbor #shared")
    );
    const result = recall(
      [
        ...neighbors.toReversed(),
        ...seeds.toReversed(),
        item("hidden", "hidden neighbor #hidden"),
        item("newest", "newest neighbor #shared", "02"),
      ],
      "cue"
    );
    expect(result.recalled.map((row) => row.ref)).toStrictEqual(
      seeds.slice(0, 20).map((row) => row.ref)
    );
    expect(result.associated.map((row) => row.ref)).toStrictEqual([
      "newest",
      ...neighbors.slice(0, 19).map((row) => row.ref),
    ]);
    expect(result.hasMoreRecalled).toBeTruthy();
    expect(result.hasMoreAssociated).toBeTruthy();
    expect(recall(seeds.slice(0, 20), "cue").hasMoreRecalled).toBeFalsy();
  });
});
