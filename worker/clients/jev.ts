import type { Fragment } from "@core";
import { z } from "zod";

import { err, ok } from "@lib/result";
import type { Result } from "@lib/result";

import { relevanceUnavailable } from "../errors";
import type { RelevanceUnavailable } from "../errors";

type Json = z.output<ReturnType<typeof z.json>>;

interface Query {
  context?: string | undefined;
  cue: string;
}

export const JEV_MODEL = "typesafe/jev";
export const JEV_TIMEOUT_MS = 1500;
export const JEV_ATTEMPTS = 3;

const UNRETRYABLE_AI_ERROR_CODES = new Set([
  3023, 3036, 3041, 3042, 5007, 5016, 5018, 5035,
]);

const AI_ERROR_CODE = /(?:^|\s)(?<code>\d{4}):/u;
const UPSTREAM_GATEWAY_ERROR = /InferenceUpstreamError/u;
const BACKOFF_MS = 250;

class JevAttemptError extends Error {
  readonly kind: "timeout" | "malformed";

  constructor(kind: "timeout" | "malformed", message: string) {
    super(message);
    this.name = "JevAttemptError";
    this.kind = kind;
  }
}

const isMalformed = (error: Error) =>
  error instanceof JevAttemptError && error.kind === "malformed";

const sleep = async (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<null>();
  setTimeout(() => resolve(null), ms);
  await promise;
};

const isTransient = (error: Error) => {
  if (error instanceof JevAttemptError) {
    return true;
  }
  const code =
    z.object({ code: z.number() }).safeParse(error).data?.code ??
    Number(AI_ERROR_CODE.exec(String(error))?.groups?.["code"]);
  if (Number.isInteger(code)) {
    return !UNRETRYABLE_AI_ERROR_CODES.has(code);
  }
  return UPSTREAM_GATEWAY_ERROR.test(String(error));
};

export interface Ai {
  run: (model: string, input: Record<string, Json>) => Promise<Json>;
}

const answersSchema = z.object({
  answers: z.record(z.string(), z.object({ noul: z.number().min(0).max(1) })),
});
const bareOrGatewayEnvelopedSchema = z.union([
  answersSchema,
  z.object({ result: answersSchema }).transform(({ result }) => result),
]);

const parseScores = (value: Json) => {
  const parsed = bareOrGatewayEnvelopedSchema.safeParse(value);
  if (!parsed.success) {
    const keys = Object.keys(z.looseObject({}).safeParse(value).data ?? {});
    throw new JevAttemptError(
      "malformed",
      `Unexpected Jev response (keys: ${keys.join(", ")})`
    );
  }
  return parsed.data.answers;
};

const question = (ref: string) => ({
  criteria: {
    false:
      "The fragment is unrelated, or related only by sharing a broad topic tag.",
    true: "The fragment states something the agent would want in front of it right now.",
  },
  instructions: `Would candidates.${ref} be useful to an agent whose current cue is \`cue\` and whose current task is \`context\`?`,
  type: "noul",
});

const withTimeout = async <T>(promise: Promise<T>, ms: number) => {
  const { promise: expired, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(
    () =>
      reject(new JevAttemptError("timeout", `Jev timed out after ${ms} ms`)),
    ms
  );
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
};

const ask = async (
  ai: Ai,
  candidates: readonly Fragment[],
  { context, cue }: Query
) => {
  const output = await withTimeout(
    ai.run(JEV_MODEL, {
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
    }),
    JEV_TIMEOUT_MS
  );
  return parseScores(output);
};

const persistent = (
  cause: string
): { error: RelevanceUnavailable; ok: false } => {
  console.error({ error: cause, event: "jev.unavailable" });
  return err(relevanceUnavailable(false));
};

const score = async (
  ai: Ai,
  candidates: readonly Fragment[],
  input: Query
): Promise<Result<Map<string, number>, RelevanceUnavailable>> => {
  const scores = new Map<string, number>();
  let failure = "";
  let allMalformed = true;
  for (let attempt = 1; attempt <= JEV_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      // oxlint-disable-next-line no-await-in-loop
      await sleep(BACKOFF_MS * (attempt - 1));
    }
    const pending = candidates.filter((item) => !scores.has(item.ref));
    try {
      // oxlint-disable-next-line no-await-in-loop
      const reply = await ask(ai, pending, input);
      allMalformed = false;
      for (const { ref } of pending) {
        const noul = reply[ref]?.noul;
        if (noul !== undefined) {
          scores.set(ref, noul);
        }
      }
      const unanswered = pending.filter((item) => !scores.has(item.ref));
      if (unanswered.length === 0) {
        break;
      }
      failure = `left ${unanswered.length} memories unanswered`;
    } catch (error) {
      const cause =
        z.instanceof(Error).safeParse(error).data ?? new Error(String(error));
      if (!isTransient(cause)) {
        return persistent(String(cause));
      }
      allMalformed &&= isMalformed(cause);
      failure = String(cause);
    }
    console.error({ attempt, error: failure, event: "jev.attempt.failed" });
  }
  if (scores.size < candidates.length) {
    if (allMalformed) {
      return persistent(failure);
    }
    return err(relevanceUnavailable(true));
  }
  return ok(scores);
};

export const jev =
  (ai: Ai) => (candidates: readonly Fragment[], input: Query) =>
    score(ai, candidates, input);
