import { Hono } from "hono";
import { z } from "zod";

import { updateSettings, viewSettings } from "../services/settings";
import type { AppEnv } from "../types";
import { errorResponse } from "./problem";

export const settings = new Hono<AppEnv>()
  .get("/", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await viewSettings(c.get("memory")));
  })
  .patch("/", async (c) => {
    const result = await updateSettings(
      c.get("memory"),
      z.record(z.string(), z.json()).parse(await c.req.json())
    );
    return result.ok ? c.json(result.value) : errorResponse(c, result.error);
  });
