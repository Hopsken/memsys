import { Hono } from "hono";

import { isDevIdentity } from "../auth";
import type { AppEnv } from "../auth";
import { corpus } from "./corpus";

// Development-only routes, mounted at /api/dev under `import.meta.env.DEV`.
// Marked pure so production builds, where nothing mounts it, drop the module.
export const dev =
  /* @__PURE__ */
  new Hono<AppEnv>().post("/seed", async (c) =>
    isDevIdentity(c.env)
      ? c.json(await c.get("memory").seed(corpus))
      : c.json({ error: "Not found" }, 404)
  );
