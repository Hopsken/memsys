import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import invariant from "tiny-invariant";

import { defaultSpace, openMemory } from "../memory";
import type { AppEnv } from "../types";

export const openMemorySpace = (
  space = (c: Context<AppEnv>) => {
    invariant(c.var.userId, "Not signed in");
    return defaultSpace(c.var.userId);
  }
) =>
  createMiddleware<AppEnv>((c, next) => {
    c.set("memory", openMemory(space(c)));
    return next();
  });
