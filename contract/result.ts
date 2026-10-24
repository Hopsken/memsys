export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T) => ({ ok: true as const, value });
export const err = <E>(error: E) => ({ error, ok: false as const });

export interface Issue {
  message: string;
  path: string[];
}

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
