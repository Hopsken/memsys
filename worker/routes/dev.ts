import type { User } from "better-auth";
import { Hono } from "hono";
import { setSignedCookie } from "hono/cookie";
import { z } from "zod";

import { MEMORY_READ, MEMORY_WRITE, getAuth } from "../lib/better-auth";
import { corpusLog } from "../lib/dev-corpus";
import { unwrap } from "../lib/problem";
import { defaultSpace, openMemory } from "../memory";
import { openMemorySpace } from "../middlewares/open-memory";
import type { AppEnv } from "../types";
import { mcp } from "./mcp";
import { settings } from "./settings";

const seedInputSchema = z.object({ email: z.email() });

const seed = (spaceId: string) =>
  openMemory(spaceId).importLog({
    content: corpusLog,
    format: "ndjson",
  });

const sameOriginPath = (returnTo: string | undefined, origin: string) => {
  if (!returnTo?.startsWith("/")) {
    return "/";
  }
  const url = new URL(returnTo, origin);
  return url.origin === origin
    ? `${url.pathname}${url.search}${url.hash}`
    : "/";
};

export const dev =
  /* @__PURE__ */
  new Hono<AppEnv>()
    .post("/api/dev/seed", async (c) => {
      const { email } = seedInputSchema.parse(await c.req.json());
      const { internalAdapter } = await getAuth(c.env).$context;
      const found = await internalAdapter.findUserByEmail(email);
      if (!found) {
        return c.json(
          { error: "No user with that email. Sign in first." },
          404
        );
      }
      return c.json(unwrap(await seed(defaultSpace(found.user.id))));
    })
    .get("/__dev/log-me-in/:email", async (c) => {
      const email = z.email().safeParse(c.req.param("email"));
      if (!email.success) {
        return c.json({ error: "Invalid email" }, 400);
      }
      const { adapter, authCookies, internalAdapter, secret } = await getAuth(
        c.env
      ).$context;
      const found = await internalAdapter.findUserByEmail(email.data);
      let user = found?.user;
      if (!user) {
        // The raw adapter skips database hooks, so no invite code is needed.
        user = await adapter.create<User>({
          data: {
            createdAt: new Date(),
            email: email.data.toLowerCase(),
            emailVerified: true,
            name: "",
            updatedAt: new Date(),
          },
          model: "user",
        });
        unwrap(await seed(defaultSpace(user.id)));
      }
      const session = await internalAdapter.createSession(user.id);
      await setSignedCookie(
        c,
        authCookies.sessionToken.name,
        session.token,
        secret,
        authCookies.sessionToken.attributes
      );
      return c.redirect(
        sameOriginPath(c.req.query("returnTo"), new URL(c.req.url).origin)
      );
    })
    .use(
      "/__dev/eval/:space/*",
      (c, next) => {
        c.set("author", "agent:eval");
        c.set("scopes", new Set([MEMORY_READ, MEMORY_WRITE]));
        return next();
      },
      openMemorySpace((c) => `eval:${c.req.param("space")}`)
    )
    .route("/__dev/eval/:space/mcp", mcp)
    .route("/__dev/eval/:space/settings", settings)
    .get("/__dev/eval/:space/export", async (c) =>
      c.text(await c.get("memory").exportLog({ history: true }))
    )
    .post("/__dev/eval/:space/import", async (c) => {
      const result = await c
        .get("memory")
        .importLog({ content: await c.req.text(), format: "ndjson" });
      return c.json(unwrap(result));
    });
