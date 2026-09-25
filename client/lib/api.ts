import ky, { isHTTPError } from "ky";
import * as z from "zod/mini";

// Retries belong to React Query; ky only shapes requests and errors.
export const api = ky.create({ cache: "no-store", retry: 0 });

// Error bodies from the worker: `issues` for 422, a message otherwise.
// Better Auth routes put their message in `message`.
const problemSchema = z.object({
  error: z.optional(z.string()),
  issues: z.optional(
    z.array(z.object({ message: z.string(), path: z.array(z.string()) }))
  ),
  message: z.optional(z.string()),
});
type Problem = z.infer<typeof problemSchema>;

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
    expired: status === 401,
    problem: z.safeParse(problemSchema, error.data).data ?? {},
    status,
  };
};

export const isExpired = (error: Error | null) =>
  error !== null && failure(error).expired;
