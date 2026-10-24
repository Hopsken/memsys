import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setSignedCookie } from "hono/cookie";
import { z } from "zod";

import {
  MEMORY_READ,
  MEMORY_WRITE,
  getAuth,
  isAllowedEmail,
} from "../lib/better-auth";
import { corpus } from "../lib/dev-corpus";
import { defaultSpace, memoryOf } from "../lib/memory";
import type { AppEnv } from "../types";
import { mcp } from "./mcp";
import { errorResponse } from "./problem";
import { settings } from "./settings";

const seedInput = z.object({ email: z.email() });

// Where to send the browser after signing in: a path on this origin.
// Anything else, such as `//host` or `/\host`, would leave the site.
const returnPath = (returnTo: string | undefined, origin: string) => {
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
      const { email } = seedInput.parse(await c.req.json());
      const { internalAdapter } = await getAuth(c.env).$context;
      const found = await internalAdapter.findUserByEmail(email);
      if (!found) {
        return c.json(
          { error: "No user with that email. Sign in first." },
          404
        );
      }
      return c.json(
        await env.MEMORY.getByName(defaultSpace(found.user.id)).seed(corpus)
      );
    })
    .get("/__dev/log-me-in/:email", async (c) => {
      const email = z.email().safeParse(c.req.param("email"));
      if (!email.success) {
        return c.json({ error: "Invalid email" }, 400);
      }
      if (!isAllowedEmail(c.env, email.data)) {
        return c.json(
          { error: "Add this email to AUTH_ALLOWED_EMAILS in .dev.vars." },
          403
        );
      }
      const { authCookies, internalAdapter, secret } = await getAuth(c.env)
        .$context;
      const found = await internalAdapter.findUserByEmail(email.data);
      let user = found?.user;
      if (!user) {
        user = await internalAdapter.createUser(
          { email: email.data, emailVerified: true, name: "" },
          { method: "email-otp" }
        );
        await env.MEMORY.getByName(defaultSpace(user.id)).seed(corpus);
      }
      const session = await internalAdapter.createSession(user.id);
      // The cookie Better Auth sets on sign-in, signed the same way.
      await setSignedCookie(
        c,
        authCookies.sessionToken.name,
        session.token,
        secret,
        authCookies.sessionToken.attributes
      );
      return c.redirect(
        returnPath(c.req.query("returnTo"), new URL(c.req.url).origin)
      );
    })
    .use("/__dev/eval/:space/*", (c, next) => {
      c.set("memory", memoryOf(`eval:${c.req.param("space")}`));
      c.set("scopes", new Set([MEMORY_READ, MEMORY_WRITE]));
      c.set("by", "agent:eval");
      return next();
    })
    .route("/__dev/eval/:space/mcp", mcp)
    .route("/__dev/eval/:space/settings", settings)
    .get("/__dev/eval/:space/export", async (c) =>
      c.text(await c.get("memory").exportLog({ history: true }))
    )
    .post("/__dev/eval/:space/import", async (c) => {
      const result = await c
        .get("memory")
        .importLog({ content: await c.req.text(), format: "ndjson" });
      return result.ok ? c.json(result.value) : errorResponse(c, result.error);
    });
