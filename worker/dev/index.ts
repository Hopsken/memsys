import { Hono } from "hono";
import { z } from "zod";

import { defaultSpace, getAuth, memoryOf } from "../auth";
import type { AppEnv } from "../auth";
import { corpus } from "./corpus";

const seedInput = z.object({ email: z.email() });

// Development-only routes, mounted at /api/dev under `import.meta.env.DEV`.
// Marked pure so production builds, where nothing mounts it, drop the module.
// They skip sign-in; anyone who can reach the dev server can use them.
export const dev =
  /* @__PURE__ */
  new Hono<AppEnv>().post("/seed", async (c) => {
    // The email only finds the user; their default space is seeded.
    const { email } = seedInput.parse(await c.req.json());
    const { internalAdapter } = await getAuth(c.env).$context;
    const found = await internalAdapter.findUserByEmail(email);
    if (!found) {
      return c.json({ error: "No user with that email. Sign in first." }, 404);
    }
    return c.json(
      await memoryOf(c.env, defaultSpace(found.user.id)).seed(corpus)
    );
  });
