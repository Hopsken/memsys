import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { Code, Failure, Result } from "@contract/result";

// The one place a failure's canonical code becomes an HTTP status. A new
// failure picks a code where it is made; nothing here changes for it.
const STATUS = {
  invalid: 422,
  "not-found": 404,
  unavailable: 503,
} satisfies Record<Code, ContentfulStatusCode>;

// Only `unavailable` needs more: whether the caller should retry, and when.
const statusOf = ({ code, retry }: Failure): ContentfulStatusCode =>
  code === "unavailable" && retry === false ? 502 : STATUS[code];

// A route's value, or the failure thrown for app.onError to send. Hono
// sends the exception's status, so the response's status must match it.
export const unwrap = <T>(result: Result<T, Failure>): T => {
  if (result.ok) {
    return result.value;
  }
  const { issues, message, retry } = result.error;
  const status = statusOf(result.error);
  throw new HTTPException(status, {
    res: Response.json(
      {
        error: message,
        ...(issues && { issues }),
        ...(retry !== undefined && { retry }),
      },
      { headers: retry === true ? { "Retry-After": "5" } : {}, status }
    ),
  });
};
