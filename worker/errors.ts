import type { Failure, Issue } from "@lib/result";

export type TooLong = Failure<"invalid", "too-long">;

export type InvalidSettings = Failure<"invalid", "invalid-settings"> & {
  issues: Issue[];
};

export type RelevanceUnavailable = Failure<
  "unavailable",
  "relevance-unavailable"
> & { retry: boolean };

export const RELEVANCE_UNAVAILABLE =
  "The relevance filter is unavailable, and retrying will not help. Tell the owner that memsys recall is down.";
export const RELEVANCE_RETRY =
  "The relevance filter could not check the memories. Retry this recall shortly.";

export const relevanceUnavailable = (retry: boolean): RelevanceUnavailable => ({
  code: "unavailable",
  message: retry ? RELEVANCE_RETRY : RELEVANCE_UNAVAILABLE,
  reason: "relevance-unavailable",
  retry,
});
