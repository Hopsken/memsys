import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import { sendSignInCode } from "./email";
import type { MemoryDO } from "./memory-do";

export interface AppEnv {
  Bindings: Env;
  Variables: { memory: DurableObjectStub<MemoryDO> };
}

// AUTH_ALLOWED_EMAILS: comma- or space-separated addresses, or `@domain`.
export const isAllowedEmail = (env: Env, email: string) => {
  const address = email.trim().toLowerCase();
  return (env.AUTH_ALLOWED_EMAILS ?? "")
    .toLowerCase()
    .split(/[\s,]+/u)
    .some(
      (entry) =>
        entry !== "" &&
        (entry.startsWith("@") ? address.endsWith(entry) : address === entry)
    );
};

const signInCodeRequest = z.object({
  email: z.string(),
  type: z.literal("sign-in"),
});

const createAuth = (env: Env) =>
  betterAuth({
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    basePath: "/api/auth",
    baseURL: env.PUBLIC_URL,
    database: env.DB,
    databaseHooks: {
      user: {
        create: {
          // Sign-in creates the account, so the allowlist is enforced here too.
          before: (user) => {
            if (!isAllowedEmail(env, user.email)) {
              throw new APIError("FORBIDDEN", {
                message: "Sign-in not allowed",
              });
            }
            return Promise.resolve();
          },
        },
      },
    },
    hooks: {
      // Tell an address outside the allowlist so, before any code is stored.
      before: createAuthMiddleware((ctx) => {
        const request = signInCodeRequest.safeParse(ctx.body);
        if (
          ctx.path === "/email-otp/send-verification-otp" &&
          request.success &&
          !isAllowedEmail(env, request.data.email)
        ) {
          throw new APIError("FORBIDDEN", {
            message: "This email is not allowed to sign in.",
          });
        }
        return Promise.resolve();
      }),
    },
    plugins: [
      emailOTP({
        // Codes go only to allowed addresses.
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type === "sign-in" && isAllowedEmail(env, email)) {
            await sendSignInCode(env, email, otp);
          }
        },
        storeOTP: "hashed",
      }),
      // MCP tokens. A key never stands in for a session, so it cannot reach
      // /api: plugin configuration and token management stay with the user.
      apiKey({
        defaultPrefix: "memsys_",
        enableSessionForAPIKeys: false,
        maximumNameLength: 64,
        rateLimit: { enabled: false },
        requireName: true,
        startingCharactersConfig: { charactersLength: 11 },
      }),
    ],
    rateLimit: { enabled: true, storage: "database" },
    secret: env.BETTER_AUTH_SECRET,
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    telemetry: { enabled: false },
  });

// Bindings are fixed per deployment; reuse one instance per env object.
const instances = new WeakMap<Env, ReturnType<typeof createAuth>>();

export const getAuth = (env: Env) => {
  let auth = instances.get(env);
  if (!auth) {
    auth = createAuth(env);
    instances.set(env, auth);
  }
  return auth;
};

// A memory space id names one memory object. Each user has a default space
// whose id is their user id; this is the only place that ties the two, so
// more spaces per user, or another sign-in system, change only this.
export const defaultSpace = (userId: string) => userId;

export const memoryOf = (env: Env, spaceId: string) =>
  env.MEMORY.getByName(spaceId);

const unauthorized = (c: Context<AppEnv>) => {
  c.header("WWW-Authenticate", 'Bearer realm="memsys"');
  return c.json({ error: "Authentication required" }, 401);
};

// The web UI and /api: a signed-in browser session.
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const result = await getAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!result) {
    return c.json({ error: "Authentication required" }, 401);
  }
  c.set("memory", memoryOf(c.env, defaultSpace(result.user.id)));
  return next();
});

// /mcp: an MCP token as a bearer token, naming the user who created it.
export const requireToken = createMiddleware<AppEnv>(async (c, next) => {
  const key = /^Bearer\s+(?<key>\S+)$/iu.exec(
    c.req.header("Authorization") ?? ""
  )?.groups?.["key"];
  if (!key) {
    return unauthorized(c);
  }
  const verified = await getAuth(c.env).api.verifyApiKey({ body: { key } });
  if (!verified.valid || !verified.key) {
    return unauthorized(c);
  }
  c.set("memory", memoryOf(c.env, defaultSpace(verified.key.referenceId)));
  return next();
});
