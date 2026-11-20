import type { Fragment } from "@core";
import { listFragments } from "@core/inputs";
import { describe, expect, it } from "vitest";

const item = (
  ref: string,
  updatedAt: string,
  versionId: number,
  fragment = `Fragment ${ref}`
): Fragment => ({
  createdAt: updatedAt,
  fragment,
  ref,
  source: null,
  updatedAt,
  versionId,
});

const TIE = "2026-01-02T00:00:00.000Z";

const tied = Array.from({ length: 50 }, (_, index) =>
  item(
    `aaaaa${String.fromCodePoint(97 + Math.floor(index / 8))}${"23456789"[index % 8]}`,
    TIE,
    100 + index
  )
);

describe("Fragment pages", () => {
  it("orders by update time then newest version, and pages past one", () => {
    const newest = item("zzzzzzz", "2026-01-03T00:00:00.000Z", 200);
    const oldest = item("2222222", "2026-01-01T00:00:00.000Z", 1);
    const corpus = [oldest, ...tied, newest];
    const first = listFragments(corpus, {});
    expect(first.fragments).toStrictEqual([
      newest,
      ...tied.toReversed().slice(0, 49),
    ]);
    expect(first.nextCursor).toBe(`${TIE},101`);
    expect(
      listFragments(corpus, { cursor: first.nextCursor ?? "" })
    ).toStrictEqual({
      fragments: [tied[0], oldest],
      nextCursor: null,
    });

    const shifted = [...corpus, item("bbbbbbb", TIE, 150)];
    expect(
      listFragments(shifted, { cursor: first.nextCursor ?? "" }).fragments
    ).toStrictEqual([tied[0], oldest]);
  });

  it("ends at an exact page boundary and handles an empty corpus", () => {
    expect(listFragments(tied, {}).nextCursor).toBeNull();
    expect(listFragments([], {})).toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
  });

  it("keeps fragments carrying every tag, namespaces included", () => {
    const corpus = [
      item("2222222", "2026-01-05T00:00:00.000Z", 1, "Plain #Project"),
      item(
        "3333333",
        "2026-01-04T00:00:00.000Z",
        2,
        "Nested #project/memsys #idea"
      ),
      item(
        "4444444",
        "2026-01-03T00:00:00.000Z",
        3,
        "Lookalike #projects #project-x"
      ),
      item(
        "5555555",
        "2026-01-02T00:00:00.000Z",
        4,
        "Deeper #project/memsys/ui"
      ),
    ];
    const refs = (tag: string[]) =>
      listFragments(corpus, { tag }).fragments.map(({ ref }) => ref);
    expect(refs(["project"])).toStrictEqual(["2222222", "3333333", "5555555"]);
    expect(refs(["project/memsys"])).toStrictEqual(["3333333", "5555555"]);
    expect(refs(["PROJECT", "idea"])).toStrictEqual(["3333333"]);
    expect(refs(["project", "projects"])).toStrictEqual([]);
    expect(refs([])).toHaveLength(4);
  });
});
