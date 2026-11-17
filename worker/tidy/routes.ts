import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import { unwrap } from "../lib/problem";
import { validate } from "../lib/validate";
import { defaultSpace } from "../memory";
import type { AppEnv } from "../types";

const startInputSchema = z.object({}).strict();
const applyInputSchema = z
  .object({ proposals: z.array(z.string().min(1).max(64)).max(100) })
  .strict();

const spaceOf = (c: Context<AppEnv>) => defaultSpace(c.var.userId);
const tidyOf = (c: Context<AppEnv>) => c.env.TIDY.getByName(spaceOf(c));

export const tidy = new Hono<AppEnv>()
  .get("/", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await tidyOf(c).read());
  })
  .post("/", validate("json", startInputSchema), async (c) =>
    c.json(unwrap(await tidyOf(c).start(spaceOf(c))))
  )
  .delete("/", async (c) => c.json(unwrap(await tidyOf(c).cancel())))
  .post("/apply", validate("json", applyInputSchema), async (c) =>
    c.json(unwrap(await tidyOf(c).apply(c.req.valid("json").proposals)))
  );
