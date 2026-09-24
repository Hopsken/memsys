import type { Json } from "../../contract/plugin";

// Access answers an expired session with a redirect or 401/403.
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.name = "SessionExpiredError";
  }
}

export const request = async (path: string, init: RequestInit = {}) => {
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
    throw new SessionExpiredError();
  }
  return response;
};

export const sendJson = (path: string, method: string, body: Json) =>
  request(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
