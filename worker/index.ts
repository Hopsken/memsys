import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { getAuth } from "./lib/better-auth";
import { requireSession } from "./middlewares/require-session";
import { requireToken } from "./middlewares/require-token";
import { connections } from "./routes/connections";
import { dev } from "./routes/dev";
import { mcp } from "./routes/mcp";
import { memory } from "./routes/memory";
import { settings } from "./routes/settings";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

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
const importBody = bodyLimit({ maxSize: 10 * 1024 * 1024 });
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
    ["PATCH", "POST", "PUT"].includes(c.req.method) &&
    mediaType !== "application/json" &&
    c.req.path !== "/api/import" &&
    !isOAuthApp(c.req.path)
  ) {
    return Promise.resolve(
      c.json({ error: "Content-Type must be application/json" }, 415)
    );
  }
  return next();
});

app.on(["GET", "POST"], ["/api/auth/*", "/.well-known/*"], (c) =>
  getAuth(c.env).handler(c.req.raw)
);
// Replaced with `false` in production builds, which then drop routes/dev.
if (import.meta.env.DEV && process.env.NODE_ENV !== "production") {
  app.route("/", dev);
}
app.use("/mcp", requireToken);
app.use("/api/*", requireSession);

app.route("/mcp", mcp);
app.route("/api", memory);
app.route("/api/connections", connections);
app.route("/api/settings", settings);

app.onError((cause, c) => {
  if (cause instanceof z.ZodError || cause instanceof SyntaxError) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  if (cause instanceof HTTPException) {
    return cause.getResponse();
  }
  return c.json({ error: "Internal server error" }, 500);
});

export default {
  // Start Better Auth here, so its setup outlives this request if needed.
  // Requests in an isolate also share work in flight, such as fetching an
  // app's client metadata document; if the request doing it is canceled,
  // every request waiting on it hangs. So each request runs to the end.
  fetch: (request: Request, env: Env, ctx?: ExecutionContext) => {
    getAuth(env, ctx);
    const response = Promise.resolve(app.fetch(request, env, ctx));
    ctx?.waitUntil(response);
    return response;
  },
};

// Wrangler takes Durable Object classes from the Worker's entry point.
export { MemoryDO } from "@core/do";
