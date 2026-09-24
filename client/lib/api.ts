import ky, { isHTTPError } from "ky";
import * as z from "zod/mini";

// Retries belong to React Query; ky only shapes requests and errors.
export const api = ky.create({
  cache: "no-store",
  redirect: "manual",
  retry: 0,
});

// Error bodies from the worker: `issues` for 422, a message otherwise.
const problemSchema = z.object({
  error: z.optional(z.string()),
  issues: z.optional(
    z.array(z.object({ message: z.string(), path: z.array(z.string()) }))
  ),
});
type Problem = z.infer<typeof problemSchema>;

// Status 0 is the opaque redirect Access sends when the session has expired.
const EXPIRED = new Set([0, 401, 403]);

interface Failure {
  expired: boolean;
  problem: Problem;
  status: number | null;
}

export const failure = (error: Error): Failure => {
  if (!isHTTPError(error)) {
    return { expired: false, problem: {}, status: null };
  }
  const { status } = error.response;
  return {
    expired: EXPIRED.has(status),
    problem: z.safeParse(problemSchema, error.data).data ?? {},
    status,
  };
};

export const isExpired = (error: Error | null) =>
  error !== null && failure(error).expired;
