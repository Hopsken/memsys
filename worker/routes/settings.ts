import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../types";
import { unwrap } from "./problem";

export const settings = new Hono<AppEnv>()
  .get("/", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await c.get("memory").settings());
  })
  .patch("/", async (c) => {
    const result = await c
      .get("memory")
      .updateSettings(z.record(z.string(), z.json()).parse(await c.req.json()));
    return c.json(unwrap(result));
  });
