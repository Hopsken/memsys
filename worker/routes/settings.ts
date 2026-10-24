import { Hono } from "hono";
import { z } from "zod";

import { unwrap } from "../lib/problem";
import { validate } from "../lib/validate";
import type { AppEnv } from "../types";

export const settings = new Hono<AppEnv>()
  .get("/", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await c.get("memory").settings());
  })
  .patch("/", validate("json", z.record(z.string(), z.json())), async (c) => {
    const result = await c.get("memory").updateSettings(c.req.valid("json"));
    return c.json(unwrap(result));
  });
