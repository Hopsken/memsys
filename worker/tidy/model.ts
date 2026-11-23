import type { Source } from "@core";

import type { Failure } from "@lib/result";

export type Change =
  | { type: "remember"; fragment: string }
  | {
      type: "revise";
      ref: string;
      fragment: string;
      versionId: number;
      current: string;
      source: Source | null;
    }
  | {
      type: "forget";
      ref: string;
      versionId: number;
      current: string;
      source: Source | null;
    };

export interface Proposal {
  id: string;
  reason: string;
  changes: Change[];
}

export interface Skipped {
  proposal: Proposal;
  reason: string;
}

export interface ApplyResult {
  applied: number;
  skipped: Skipped[];
}

export type TidyState =
  | { status: "idle"; last?: ApplyResult }
  | { status: "running"; runId: string; startedAt: string; attempts: number }
  | {
      status: "ready";
      runId: string;
      proposals: Proposal[];
      summary: string;
      finishedAt: string;
    }
  | {
      status: "applying";
      runId: string;
      proposals: Proposal[];
      done: string[];
      skipped: Skipped[];
    }
  | { status: "failed"; message: string; retry: boolean };

export type TidyBusy = Failure<"conflict", "tidy-busy">;

export const tidyBusy = (message: string): TidyBusy => ({
  code: "conflict",
  message,
  reason: "tidy-busy",
});
