import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { access } from "./auth";
import type { AppEnv } from "./auth";
import { createMcpServer } from "./mcp";
import { inputs, listInput } from "./memory";

const app = new Hono<AppEnv>();

app.use("*", (c, next) => {
  const origin = c.req.header("Origin");
  if (origin !== undefined && origin !== new URL(c.req.url).origin) {
    return Promise.resolve(c.json({ error: "Untrusted origin" }, 403));
  }
  return next();
});
app.use("*", access);
app.use("*", bodyLimit({ maxSize: 32 * 1024 }));
app.use("/api/*", (c, next) => {
  const mediaType = c.req
    .header("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (c.req.method === "POST" && mediaType !== "application/json") {
    return Promise.resolve(
      c.json({ error: "Content-Type must be application/json" }, 415)
    );
  }
  return next();
});

app.all("/mcp", async (c) => {
  if (c.req.method !== "POST") {
    c.header("Allow", "POST");
    return c.json({ error: "Stateless MCP supports POST only" }, 405);
  }
  const server = await createMcpServer(c.get("memory"));
  const transport = new StreamableHTTPTransport({
    // Omit sessionIdGenerator to use stateless mode.
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(c);
  } finally {
    await server.close();
  }
});

app.get("/api/fragments", async (c) => {
  c.header("Cache-Control", "no-store");
  const query = c.req.query();
  if (!listInput.safeParse(query).success) {
    return c.json({ error: "Invalid list query" }, 400);
  }
  // Hono's query object has a null prototype; RPC requires a plain object.
  return c.json(await c.get("memory").list({ ...query }));
});

app.get("/api/plugins", (c) => c.get("memory").listPlugins());

app.post("/api/remember", async (c) => {
  const result = await c
    .get("memory")
    .remember(inputs.remember.parse(await c.req.json()));
  return "error" in result ? c.json(result, 422) : c.json(result, 201);
});
app.post("/api/recall", async (c) =>
  c.json(await c.get("memory").recall(inputs.recall.parse(await c.req.json())))
);
app.post("/api/revise", async (c) => {
  const result = await c
    .get("memory")
    .revise(inputs.revise.parse(await c.req.json()));
  if (!result) {
    return c.json({ error: "Fragment not found" }, 404);
  }
  return "error" in result ? c.json(result, 422) : c.json(result);
});
app.post("/api/forget", async (c) => {
  const result = await c
    .get("memory")
    .forget(inputs.forget.parse(await c.req.json()));
  return result ? c.json(result) : c.json({ error: "Fragment not found" }, 404);
});

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
