import type { Issue } from "@contract/result";

// The Worker's own expected failures, told apart by `kind` like the core's.

// A memory longer than the owner's limit.
export interface TooLong {
  kind: "too-long";
  length: number;
  limit: number;
}

export interface InvalidSettings {
  kind: "invalid-settings";
  issues: Issue[];
}

// The relevance filter could not judge every candidate. `retry` says
// whether trying again shortly can help, or the owner must act.
export interface RelevanceUnavailable {
  kind: "relevance-unavailable";
  retry: boolean;
}
