import { Hono } from "hono";

import type { AppEnv } from "../types";

export const diagnostics = new Hono<AppEnv>().get("/", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({
    memory: await c.get("memory").diagnostics(),
    userId: c.get("userId"),
    worker: { colo: c.req.raw.cf?.colo ?? null },
  });
});
