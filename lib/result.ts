export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T) => ({ ok: true as const, value });
export const err = <E>(error: E) => ({ error, ok: false as const });

export interface Issue {
  message: string;
  path: string[];
}

export type Code = "invalid" | "not-found" | "unavailable";

export interface Failure<C extends Code = Code, R extends string = string> {
  code: C;
  reason: R;
  message: string;
  issues?: Issue[];
  retry?: boolean;
}
