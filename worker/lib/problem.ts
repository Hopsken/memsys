import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { Code, Failure, Result } from "@lib/result";

const RETRY_AFTER_SECONDS = "5";

const STATUS_BY_CODE = {
  invalid: 422,
  "not-found": 404,
  unavailable: 503,
} satisfies Record<Code, ContentfulStatusCode>;

const statusOf = ({ code, retry }: Failure): ContentfulStatusCode =>
  code === "unavailable" && retry === false ? 502 : STATUS_BY_CODE[code];

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
      {
        headers: retry === true ? { "Retry-After": RETRY_AFTER_SECONDS } : {},
        status,
      }
    ),
  });
};
