import type { Issue } from "@contract/result";

export interface TooLong {
  kind: "too-long";
  length: number;
  limit: number;
}

export interface InvalidSettings {
  kind: "invalid-settings";
  issues: Issue[];
}

export interface RelevanceUnavailable {
  kind: "relevance-unavailable";
  retry: boolean;
}
