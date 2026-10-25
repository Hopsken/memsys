import type { Failure, Issue } from "@lib/result";

export type TooLong = Failure<"invalid", "too-long">;

export type InvalidSettings = Failure<"invalid", "invalid-settings"> & {
  issues: Issue[];
};

export type RelevanceUnavailable = Failure<
  "unavailable",
  "relevance-unavailable"
> & { retry: boolean };

export const RELEVANCE_UNCHECKED =
  "The relevance filter is unavailable, so these memories were not checked against your task and may include unrelated ones.";

export const relevanceUnavailable = (retry: boolean): RelevanceUnavailable => ({
  code: "unavailable",
  message: RELEVANCE_UNCHECKED,
  reason: "relevance-unavailable",
  retry,
});
