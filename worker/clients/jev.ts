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
  cues: string[];
}

export const JEV_MODEL = "typesafe/jev";
export const JEV_TIMEOUT_MS = 3000;
export const JEV_ATTEMPTS = 3;

const BACKOFF_MS = 250;

export type Fetch = (input: Input, init?: RequestInit) => Promise<Response>;

const answersSchema = z.object({
  answers: z.record(z.string(), z.object({ noul: z.number().min(0).max(1) })),
});

export const USEFUL =
  "A fragment is useful when it states something the agent would want in front of it right now; not when it is unrelated or only shares a broad topic tag.";

const question = (ref: string) => ({
  instructions: `Is \`candidates.${ref}\` \`useful\` for the agent's \`cue\` and \`context\`?`,
  type: "noul",
});

const questionsAbout = (
  candidates: readonly Fragment[],
  { context, cues }: Query
) => ({
  questions: Object.fromEntries(
    candidates.map((item) => [item.ref, question(item.ref)])
  ),
  state: {
    candidates: Object.fromEntries(
      candidates.map((item) => [item.ref, item.fragment])
    ),
    context: context ?? "",
    cue: cues.join(" | "),
    useful: USEFUL,
  },
});

const persistent = (
  cause: string
): { error: RelevanceUnavailable; ok: false } => {
  console.error({ error: cause, event: "jev.unavailable" });
  return err(relevanceUnavailable(false));
};

const TOO_LARGE = "too-large";

type Scores = Result<Map<string, number>, RelevanceUnavailable>;

const score = async (
  fetch: Fetch,
  candidates: readonly Fragment[],
  input: Query
): Promise<
  Result<Map<string, number>, RelevanceUnavailable | typeof TOO_LARGE>
> => {
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
          statusCodes: [503],
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
    if (isHTTPError(error) && error.response.status === 413) {
      console.error({ candidates: candidates.length, event: "jev.too-large" });
      return err(TOO_LARGE);
    }
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

// A token spans at least one byte, so the bytes / 4 estimate is off by at most
// 4x and two splits fit. Two splits also stay at 7 Jev calls with 4 at once,
// under the Workers limits of 50 subrequests (free plan) and 6 open
// connections, and stop a 7003 that is not about size.
const MAX_SPLITS = 2;

const scoreSplitting = async (
  fetch: Fetch,
  candidates: readonly Fragment[],
  input: Query,
  splitsLeft: number
): Promise<Scores> => {
  const scores = await score(fetch, candidates, input);
  if (scores.ok) {
    return scores;
  }
  if (scores.error !== TOO_LARGE) {
    return err(scores.error);
  }
  if (splitsLeft === 0 || candidates.length === 1) {
    return persistent("Input too large to split further");
  }
  const middle = Math.ceil(candidates.length / 2);
  const halves = await Promise.all(
    [candidates.slice(0, middle), candidates.slice(middle)].map((half) =>
      scoreSplitting(fetch, half, input, splitsLeft - 1)
    )
  );
  const merged = new Map<string, number>();
  for (const half of halves) {
    if (!half.ok) {
      return half;
    }
    for (const [ref, value] of half.value) {
      merged.set(ref, value);
    }
  }
  return ok(merged);
};

export const jev =
  (fetch: Fetch) => (candidates: readonly Fragment[], input: Query) =>
    scoreSplitting(fetch, candidates, input, MAX_SPLITS);
