import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { InvalidInput, Issue, NotFound } from "../../contract/result";
import type { InvalidSettings, RelevanceUnavailable, TooLong } from "../errors";

export type AppError =
  | InvalidInput
  | InvalidSettings
  | NotFound
  | RelevanceUnavailable
  | TooLong;

// What the agent and the owner read when the relevance filter fails. The
// cause never reaches them: neither can fix Workers AI.
export const RELEVANCE_UNAVAILABLE =
  "The relevance filter is unavailable, and retrying will not help. Recall works again once the owner turns the filter off under Settings → Features in memsys.";
export const RELEVANCE_RETRY =
  "The relevance filter could not check the memories. Retry this recall shortly.";

interface Problem {
  body: { error: string; issues?: Issue[]; retry?: boolean };
  headers?: Record<string, string>;
  status: ContentfulStatusCode;
}

// The one place an error value becomes what a client sees.
export const problem = (error: AppError): Problem => {
  switch (error.kind) {
    case "not-found": {
      return {
        body: {
          error:
            error.at === undefined ? "Fragment not found" : "Version not found",
        },
        status: 404,
      };
    }
    case "invalid-input": {
      return {
        body: { error: error.message, issues: error.issues },
        status: 422,
      };
    }
    case "invalid-settings": {
      return {
        body: { error: "Invalid settings", issues: error.issues },
        status: 422,
      };
    }
    case "too-long": {
      return {
        body: {
          error: `Fragment contains ${error.length} characters, above the limit of ${error.limit}. Split it into smaller fragments.`,
        },
        status: 422,
      };
    }
    case "relevance-unavailable": {
      // An outage is worth retrying; a filter the owner must turn off is not.
      return error.retry
        ? {
            body: { error: RELEVANCE_RETRY, retry: true },
            headers: { "Retry-After": "5" },
            status: 503,
          }
        : { body: { error: RELEVANCE_UNAVAILABLE, retry: false }, status: 502 };
    }
    default: {
      return error satisfies never;
    }
  }
};

export const errorResponse = (c: Context, error: AppError) => {
  const { body, headers, status } = problem(error);
  return c.json(body, status, headers);
};
