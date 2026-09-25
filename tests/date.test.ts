import { describe, expect, it } from "vitest";

import { formatRelativeDate, formatRelativeDateInline } from "../lib/date";

const now = new Date(2026, 8, 24, 9, 30);

describe(formatRelativeDate, () => {
  it.each([
    [new Date(2026, 8, 24, 0, 5), "Today"],
    [new Date(2026, 8, 23, 23, 59), "Yesterday"],
    [new Date(2026, 8, 22, 12), "Sep 22"],
    [new Date(2026, 0, 1), "Jan 1"],
    [new Date(2025, 3, 1), "Apr 1, 2025"],
  ])("formats %s as %s", (date, expected) => {
    expect(formatRelativeDate(date, now)).toBe(expected);
  });

  it("reads inside a sentence", () => {
    expect(formatRelativeDateInline(new Date(2026, 8, 24, 8), now)).toBe(
      "today"
    );
    expect(formatRelativeDateInline(new Date(2026, 8, 22, 12), now)).toBe(
      "on Sep 22"
    );
  });

  it("accepts ISO strings", () => {
    expect(formatRelativeDate(new Date(2026, 4, 5).toISOString(), now)).toBe(
      "May 5"
    );
  });
});
