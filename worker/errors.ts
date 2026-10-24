import type { Failure, Issue } from "@contract/result";

export type TooLong = Failure<"invalid", "too-long">;

export type InvalidSettings = Failure<"invalid", "invalid-settings"> & {
  issues: Issue[];
};

export type RelevanceUnavailable = Failure<
  "unavailable",
  "relevance-unavailable"
> & { retry: boolean };

export const RELEVANCE_UNAVAILABLE =
  "The relevance filter is unavailable, and retrying will not help. Recall works again once the owner turns the filter off under Settings → Features in memsys.";
export const RELEVANCE_RETRY =
  "The relevance filter could not check the memories. Retry this recall shortly.";

export const relevanceUnavailable = (retry: boolean): RelevanceUnavailable => ({
  code: "unavailable",
  message: retry ? RELEVANCE_RETRY : RELEVANCE_UNAVAILABLE,
  reason: "relevance-unavailable",
  retry,
});
