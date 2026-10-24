import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";

import type { AppEnv } from "../types";
import { unwrap } from "./problem";

export const settings = new Hono<AppEnv>()
  .get("/", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await c.get("memory").settings());
  })
  .patch(
    "/",
    validator("json", (value) => z.record(z.string(), z.json()).parse(value)),
    async (c) => {
      const result = await c.get("memory").updateSettings(c.req.valid("json"));
      return c.json(unwrap(result));
    }
  );
