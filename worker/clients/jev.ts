import type { Fragment } from "@core";
import ky, { isHTTPError, isTimeoutError } from "ky";
import type { Input } from "ky";
import { z } from "zod";

import { err, ok } from "@lib/result";
import type { Result } from "@lib/result";

import { relevanceUnavailable } from "../errors";
import type { RelevanceUnavailable } from "../errors";
import { WORKERS_AI_URL, workersAiErrorSchema } from "./workers-ai";

interface Query {
  context?: string | undefined;
  cue: string;
}

export const JEV_MODEL = "typesafe/jev";
export const JEV_TIMEOUT_MS = 1500;
export const JEV_ATTEMPTS = 3;

const BACKOFF_MS = 250;

export type Fetch = (input: Input, init?: RequestInit) => Promise<Response>;

const answersSchema = z.object({
  answers: z.record(z.string(), z.object({ noul: z.number().min(0).max(1) })),
});

const question = (ref: string) => ({
  criteria: {
    false:
      "The fragment is unrelated, or related only by sharing a broad topic tag.",
    true: "The fragment states something the agent would want in front of it right now.",
  },
  instructions: `Would candidates.${ref} be useful to an agent whose current cue is \`cue\` and whose current task is \`context\`?`,
  type: "noul",
});

const questionsAbout = (
  candidates: readonly Fragment[],
  { context, cue }: Query
) => ({
  questions: Object.fromEntries(
    candidates.map((item) => [item.ref, question(item.ref)])
  ),
  state: {
    candidates: Object.fromEntries(
      candidates.map((item) => [item.ref, item.fragment])
    ),
    context: context ?? "",
    cue,
  },
});

const persistent = (
  cause: string
): { error: RelevanceUnavailable; ok: false } => {
  console.error({ error: cause, event: "jev.unavailable" });
  return err(relevanceUnavailable(false));
};

const score = async (
  fetch: Fetch,
  candidates: readonly Fragment[],
  input: Query
): Promise<Result<Map<string, number>, RelevanceUnavailable>> => {
  try {
    const reply = await ky
      .post(`${WORKERS_AI_URL}${JEV_MODEL}`, {
        fetch,
        hooks: {
          beforeRetry: [
            ({ error, retryCount }) => {
              console.error({
                attempt: retryCount,
                error: String(error),
                event: "jev.attempt.failed",
              });
            },
          ],
        },
        json: questionsAbout(candidates, input),
        retry: {
          delay: (attempt) => BACKOFF_MS * attempt,
          limit: JEV_ATTEMPTS - 1,
          methods: ["post"],
          retryOnTimeout: true,
        },
        timeout: JEV_TIMEOUT_MS,
      })
      .json(answersSchema);
    return ok(
      new Map(
        Object.entries(reply.answers).map(([ref, { noul }]) => [ref, noul])
      )
    );
  } catch (error) {
    if (
      isTimeoutError(error) ||
      (isHTTPError(error) && error.response.status === 503)
    ) {
      return err(relevanceUnavailable(true));
    }
    return persistent(
      isHTTPError(error)
        ? (workersAiErrorSchema.safeParse(error.data).data?.error ??
            String(error))
        : String(error)
    );
  }
};

export const jev =
  (fetch: Fetch) => (candidates: readonly Fragment[], input: Query) =>
    score(fetch, candidates, input);
