import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import invariant from "tiny-invariant";

import { defaultSpace, openMemory } from "../memory";
import type { AppEnv } from "../types";

// Puts the MemoryService for a memory space in c.var.memory.
export const openMemoryOf = (space: (c: Context<AppEnv>) => string) =>
  createMiddleware<AppEnv>((c, next) => {
    c.set("memory", openMemory(space(c)));
    return next();
  });

// Mount it after the sign-in middleware: c.var.userId says whose space it is.
export const openUserMemory = openMemoryOf((c) => {
  invariant(c.var.userId, "Not signed in");
  return defaultSpace(c.var.userId);
});
