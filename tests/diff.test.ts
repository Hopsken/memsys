import { describe, expect, it } from "vitest";

import { diffWords } from "../client/shared/lib/diff";

describe("Word diff", () => {
  it("groups a replaced phrase into one removal and one addition", () => {
    expect(
      diffWords(
        "Deploys go through wrangler. #memsys",
        "Deploys go through `pnpm deploy`, which applies migrations first. #memsys"
      )
    ).toStrictEqual([
      { kind: "same", text: "Deploys go through " },
      { kind: "removed", text: "wrangler" },
      { kind: "added", text: "`pnpm deploy`, which applies migrations first" },
      { kind: "same", text: ". #memsys" },
    ]);
  });

  it("splits text without spaces into words", () => {
    expect(diffWords("我喜欢喝咖啡", "我喜欢喝茶")).toStrictEqual([
      { kind: "same", text: "我喜欢" },
      { kind: "removed", text: "喝咖啡" },
      { kind: "added", text: "喝茶" },
    ]);
  });

  it("marks pure additions and removals", () => {
    expect(diffWords("Use pnpm", "Use pnpm, not npm")).toStrictEqual([
      { kind: "same", text: "Use pnpm" },
      { kind: "added", text: ", not npm" },
    ]);
    expect(
      diffWords("Prefers pnpm #tools", "Prefers pnpm, never npm #tools")
    ).toStrictEqual([
      { kind: "same", text: "Prefers pnpm" },
      { kind: "added", text: ", never npm " },
      { kind: "same", text: "#tools" },
    ]);
    expect(diffWords("Use pnpm, not npm", "Use pnpm")).toStrictEqual([
      { kind: "same", text: "Use pnpm" },
      { kind: "removed", text: ", not npm" },
    ]);
  });

  it("gives up when most of the text changed", () => {
    expect(
      diffWords("The office is in Berlin", "Meetings happen on Tuesdays")
    ).toBeNull();
  });
});
