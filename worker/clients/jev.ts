import { z } from "zod";

import type { Fragment, Json, JsonObject, RecallInput } from "@contract/memory";
import { err, ok } from "@contract/result";
import type { Result } from "@contract/result";

import type { RelevanceUnavailable } from "../errors";

// Jev on Workers AI scores every candidate: one independent noul per
// candidate, so "nothing is relevant" is a possible answer. It retries what
// it can and says whether the caller should retry the rest.
export const JEV_MODEL = "typesafe/jev";
export const JEV_TIMEOUT_MS = 1500;
// Tries per recall; each retry asks only about candidates still unanswered.
export const JEV_ATTEMPTS = 3;

// Workers AI codes that retrying cannot fix: no balance, a model that is gone,
// or an account or plan that may not use it.
const PERSISTENT = new Set([3023, 3036, 3041, 3042, 5007, 5016, 5018, 5035]);

// The binding throws `AiError: 3036: …`; some versions also set `code`.
const AI_ERROR_CODE = /(?:^|\s)(?<code>\d{4}):/u;
// Gateway failures between the binding and the model carry no code.
const UPSTREAM = /InferenceUpstreamError/u;
// Waits before the second and third attempts, so a capacity error can clear.
const BACKOFF_MS = 250;

// An attempt that failed on Jev's side of the call.
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

// Whether retrying can fix a failed attempt. Anything not known to be an
// outage is persistent: a missing binding or an unknown error does not
// clear on its own, and an agent told to retry would retry forever.
const isTransient = (error: Error) => {
  if (error instanceof JevAttemptError) {
    return true;
  }
  const code =
    z.object({ code: z.number() }).safeParse(error).data?.code ??
    Number(AI_ERROR_CODE.exec(String(error))?.groups?.["code"]);
  if (Number.isInteger(code)) {
    return !PERSISTENT.has(code);
  }
  return UPSTREAM.test(String(error));
};

// Workers AI, narrowed to one call. Output is model JSON; Jev checks its shape.
export interface Ai {
  run: (model: string, input: JsonObject) => Promise<Json>;
}

const answers = z.object({
  answers: z.record(z.string(), z.object({ noul: z.number().min(0).max(1) })),
});
// Workers AI wraps Jev's body in a gateway envelope ({ state, result, … });
// the model docs show it bare. Accept both.
const response = z.union([
  answers,
  z.object({ result: answers }).transform(({ result }) => result),
]);

const parseScores = (value: Json) => {
  const parsed = response.safeParse(value);
  if (!parsed.success) {
    const keys = Object.keys(z.looseObject({}).safeParse(value).data ?? {});
    throw new JevAttemptError(
      "malformed",
      `Unexpected Jev response (keys: ${keys.join(", ")})`
    );
  }
  return parsed.data.answers;
};

// Keys are refs; Jev does not show keys to the model, so they are safe ids.
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
  { context, cue }: RecallInput
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

// The cause goes only to the log: neither the agent nor the owner can fix
// Workers AI, since the service pays for it.
const persistent = (
  cause: string
): { error: RelevanceUnavailable; ok: false } => {
  console.error({ error: cause, event: "jev.unavailable" });
  return err({ kind: "relevance-unavailable", retry: false });
};

// A score for every candidate, or a failure that says whether a retry can
// help.
const score = async (
  ai: Ai,
  candidates: readonly Fragment[],
  input: RecallInput
): Promise<Result<Map<string, number>, RelevanceUnavailable>> => {
  const scores = new Map<string, number>();
  let failure = "";
  let allMalformed = true;
  for (let attempt = 1; attempt <= JEV_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      // Sequential by design: each retry waits a little longer.
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
    // A response that never parses means the model changed, not an outage.
    if (allMalformed) {
      return persistent(failure);
    }
    return err({ kind: "relevance-unavailable", retry: true });
  }
  return ok(scores);
};

// Jev on Workers AI as recall's relevance judge.
export const jev =
  (ai: Ai) => (candidates: readonly Fragment[], input: RecallInput) =>
    score(ai, candidates, input);
