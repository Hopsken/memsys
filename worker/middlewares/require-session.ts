import { createMiddleware } from "hono/factory";

import { getAuth } from "../lib/better-auth";
import type { AppEnv } from "../types";

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const { headers, response } = await getAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
    returnHeaders: true,
  });
  const forwardCookies = () => {
    for (const cookie of headers.getSetCookie()) {
      c.header("Set-Cookie", cookie, { append: true });
    }
  };
  if (!response) {
    forwardCookies();
    return c.json({ error: "Authentication required" }, 401);
  }
  c.set("source", "user");
  c.set("userId", response.user.id);
  return next().then(forwardCookies);
});
