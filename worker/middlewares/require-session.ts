import { createMiddleware } from "hono/factory";

import { getAuth } from "../lib/better-auth";
import { defaultSpace, openMemory } from "../lib/memory";
import type { AppEnv } from "../types";

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const result = await getAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!result) {
    return c.json({ error: "Authentication required" }, 401);
  }
  c.set("memory", openMemory(defaultSpace(result.user.id), "user"));
  c.set("userId", result.user.id);
  return next();
});
