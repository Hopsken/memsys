export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T) => ({ ok: true as const, value });
export const err = <E>(error: E) => ({ error, ok: false as const });

export interface Issue {
  message: string;
  path: string[];
}

// An expected failure, after Google's AIP-193: `code` is one of a few
// canonical classes and alone decides the HTTP status; `reason` names the
// exact cause for machines; `message` is written for whoever reads it.
// Plain data, so it crosses Durable Object RPC.
export type Code = "invalid" | "not-found" | "unavailable";

export interface Failure<C extends Code = Code, R extends string = string> {
  code: C;
  reason: R;
  message: string;
  issues?: Issue[];
  // For `unavailable`: whether retrying shortly can help.
  retry?: boolean;
}

export type NotFound = Failure<
  "not-found",
  "fragment-not-found" | "version-not-found"
>;
export type InvalidInput = Failure<"invalid", "invalid-input"> & {
  issues: Issue[];
};
