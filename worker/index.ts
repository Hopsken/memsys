import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { getAuth, requireSession, requireToken } from "./auth";
import type { AppEnv } from "./auth";
import { dev } from "./dev";
import { connections } from "./routes/connections";
import { mcp } from "./routes/mcp";
import { memory } from "./routes/memory";
import { plugins } from "./routes/plugins";

const app = new Hono<AppEnv>();

// OAuth endpoints MCP apps call directly, from any origin and with their own
// credentials rather than a cookie, in the form encoding OAuth uses.
const OAUTH_APP_PATHS = new Set([
  "/api/auth/jwks",
  "/api/auth/oauth2/introspect",
  "/api/auth/oauth2/register",
  "/api/auth/oauth2/revoke",
  "/api/auth/oauth2/token",
]);
const isOAuthApp = (path: string) =>
  path.startsWith("/.well-known/") || OAUTH_APP_PATHS.has(path);

const oauthCors = cors({ origin: "*" });
app.use("*", (c, next) =>
  isOAuthApp(c.req.path) ? oauthCors(c, next) : next()
);
app.use("*", (c, next) => {
  const origin = c.req.header("Origin");
  if (
    origin !== undefined &&
    origin !== new URL(c.req.url).origin &&
    !isOAuthApp(c.req.path)
  ) {
    return Promise.resolve(c.json({ error: "Untrusted origin" }, 403));
  }
  return next();
});
const requestBody = bodyLimit({ maxSize: 32 * 1024 });
// A whole memory: roughly ten thousand fragments of a few hundred characters.
const importBody = bodyLimit({ maxSize: 5 * 1024 * 1024 });
app.use("*", (c, next) =>
  (c.req.path === "/api/import" ? importBody : requestBody)(c, next)
);
app.use("/api/*", (c, next) => {
  const mediaType = c.req
    .header("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    (c.req.method === "POST" || c.req.method === "PUT") &&
    mediaType !== "application/json" &&
    !isOAuthApp(c.req.path)
  ) {
    return Promise.resolve(
      c.json({ error: "Content-Type must be application/json" }, 415)
    );
  }
  return next();
});

// Better Auth answers sign-in, session, and token management itself, and
// the OAuth discovery documents MCP apps look for at the root.
app.on(["GET", "POST"], ["/api/auth/*", "/.well-known/*"], (c) =>
  getAuth(c.env).handler(c.req.raw)
);
// Replaced with `false` in production builds, which then drop worker/dev.
if (import.meta.env.DEV) {
  app.route("/api/dev", dev);
}
// Agents hold API keys or OAuth tokens; only a signed-in user reaches the rest of /api.
app.use("/mcp", requireToken);
app.use("/api/*", requireSession);

app.route("/mcp", mcp);
app.route("/api", memory);
app.route("/api/connections", connections);
app.route("/api/plugins", plugins);

app.onError((cause, c) => {
  if (cause instanceof z.ZodError || cause instanceof SyntaxError) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  if (cause instanceof HTTPException) {
    return cause.getResponse();
  }
  return c.json({ error: "Internal server error" }, 500);
});

export default { fetch: app.fetch };

export { MemoryDO } from "./memory-do";
