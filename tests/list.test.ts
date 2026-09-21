import { describe, expect, it } from "vitest";

import { listFragments } from "../worker/memory";
import type { Fragment } from "../worker/memory";

const item = (
  ref: string,
  updatedAt = "2026-01-02T00:00:00.000Z"
): Fragment => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  fragment: `Fragment ${ref}`,
  ref,
  updatedAt,
});

const tied = Array.from({ length: 50 }, (_, index) =>
  item(
    `aaaaa${String.fromCodePoint(97 + Math.floor(index / 8))}${"23456789"[index % 8]}`
  )
);

describe("Fragment pages", () => {
  it("uses newest update then ascending ref across the 50-item boundary", () => {
    const newest = item("zzzzzzz", "2026-01-03T00:00:00.000Z");
    const oldest = item("2222222", "2026-01-01T00:00:00.000Z");
    const corpus = [oldest, ...tied.toReversed(), newest];
    const first = listFragments(corpus, {});
    expect(first.fragments).toStrictEqual([newest, ...tied.slice(0, 49)]);
    expect(
      listFragments(corpus, { cursor: first.nextCursor ?? "" })
    ).toStrictEqual({
      fragments: [tied[49], oldest],
      nextCursor: null,
    });
    // A deleted cursor row and a new head row must not shift the next page.
    const changed = corpus.filter(
      (row) => row.ref !== first.fragments.at(-1)?.ref
    );
    changed.push(item("3333333", "2026-01-04T00:00:00.000Z"));
    expect(
      listFragments(changed, { cursor: first.nextCursor ?? "" }).fragments
    ).toStrictEqual([tied[49], oldest]);
  });

  it("ends at an exact page boundary and handles an empty corpus", () => {
    expect(listFragments(tied, {}).nextCursor).toBeNull();
    expect(listFragments([], {})).toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
  });
});
