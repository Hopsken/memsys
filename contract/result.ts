// What an operation that can fail in an expected way returns. Plain objects,
// so a result crosses the Durable Object RPC and JSON unchanged. Bugs throw.
// Types and two constructors only; no local imports.

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T) => ({ ok: true as const, value });
export const err = <E>(error: E) => ({ error, ok: false as const });

export interface Issue {
  message: string;
  path: string[];
}

// The core's errors. Each is told apart by `kind`.
// `at` names a version of the fragment when that version was asked for.
export interface NotFound {
  kind: "not-found";
  ref: string;
  at?: number;
}
export interface InvalidInput {
  kind: "invalid-input";
  message: string;
  issues: Issue[];
}
