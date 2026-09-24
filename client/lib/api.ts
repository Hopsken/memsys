import * as z from "zod/mini";

import type { Json } from "../../contract/plugin";

// Error bodies from the worker: `issues` for 422, a message otherwise.
const problemSchema = z.object({
  error: z.optional(z.string()),
  issues: z.optional(
    z.array(z.object({ message: z.string(), path: z.array(z.string()) }))
  ),
});
export type Problem = z.infer<typeof problemSchema>;

// Access answers an expired session with a redirect or 401/403; all become 401.
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem;

  constructor(status: number, problem: Problem = {}) {
    super(problem.error ?? `Request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
}

export const isExpired = (error: Error | null) =>
  error instanceof ApiError && error.status === 401;

const request = async (path: string, init: RequestInit) => {
  const response = await fetch(path, {
    cache: "no-store",
    redirect: "manual",
    ...init,
  });
  if (
    response.type === "opaqueredirect" ||
    response.status === 401 ||
    response.status === 403
  ) {
    throw new ApiError(401);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      z.safeParse(problemSchema, body).data ?? {}
    );
  }
  return response;
};

export const getJson = async <T>(path: string, signal?: AbortSignal) => {
  const response = await request(path, { signal: signal ?? null });
  return response.json<T>();
};

export const sendJson = async <T>(
  path: string,
  method: string,
  body?: Json
) => {
  const response = await request(path, {
    method,
    ...(body !== undefined && {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  });
  return response.json<T>();
};
