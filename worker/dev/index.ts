import { Hono } from "hono";
import { setSignedCookie } from "hono/cookie";
import { z } from "zod";

import { defaultSpace, getAuth, isAllowedEmail, memoryOf } from "../auth";
import type { AppEnv } from "../auth";
import { corpus } from "./corpus";

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

// Development-only routes, mounted under `import.meta.env.DEV`.
// Marked pure so production builds, where nothing mounts it, drop the module.
// They skip sign-in; anyone who can reach the dev server can use them.
export const dev =
  /* @__PURE__ */
  new Hono<AppEnv>()
    .post("/api/dev/seed", async (c) => {
      // The email only finds the user; their default space is seeded.
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
        await memoryOf(c.env, defaultSpace(found.user.id)).seed(corpus)
      );
    })
    // Signs the browser in as anyone on the allowlist, creating the account
    // with the seed corpus the first time, then sends it to `returnTo`.
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
        // Created as email sign-in creates accounts.
        user = await internalAdapter.createUser(
          { email: email.data, emailVerified: true, name: "" },
          { method: "email-otp" }
        );
        await memoryOf(c.env, defaultSpace(user.id)).seed(corpus);
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
    });
