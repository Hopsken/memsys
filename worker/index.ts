import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { getAuth, requireSession, requireToken } from "./auth";
import type { AppEnv } from "./auth";
import { dev } from "./dev";
import { mcp } from "./routes/mcp";
import { memory } from "./routes/memory";
import { plugins } from "./routes/plugins";

const app = new Hono<AppEnv>();

app.use("*", (c, next) => {
  const origin = c.req.header("Origin");
  if (origin !== undefined && origin !== new URL(c.req.url).origin) {
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
    mediaType !== "application/json"
  ) {
    return Promise.resolve(
      c.json({ error: "Content-Type must be application/json" }, 415)
    );
  }
  return next();
});

// Better Auth answers sign-in, session, and token management itself.
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  getAuth(c.env).handler(c.req.raw)
);
// Replaced with `false` in production builds, which then drop worker/dev.
if (import.meta.env.DEV) {
  app.route("/api/dev", dev);
}
// Agents hold MCP tokens; only a signed-in user reaches the rest of /api.
app.use("/mcp", requireToken);
app.use("/api/*", requireSession);

app.route("/mcp", mcp);
app.route("/api", memory);
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
