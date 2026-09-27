import {
  WebStandardStreamableHTTPServerTransport,
  createMcpHandler,
  isLegacyRequest,
} from "@modelcontextprotocol/server";
import { Hono } from "hono";

import type { AppEnv } from "../auth";
import { createMcpServer } from "../mcp";

// Stateless MCP over Streamable HTTP, mounted at /mcp. Each request gets its
// own server bound to the caller's memory and scopes.
export const mcp = new Hono<AppEnv>().all("/", async (c) => {
  if (c.req.method !== "POST") {
    c.header("Allow", "POST");
    return c.json({ error: "Stateless MCP supports POST only" }, 405);
  }
  const memory = c.get("memory");
  const scopes = c.get("scopes");
  const factory = () => createMcpServer(memory, scopes);
  if (!(await isLegacyRequest(c.req.raw))) {
    return await createMcpHandler(factory, { legacy: "reject" }).fetch(
      c.req.raw
    );
  }
  // 2025-era clients keep plain JSON responses; the SDK's built-in legacy
  // fallback would stream every response as SSE.
  const server = await factory();
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(c.req.raw);
  } finally {
    await server.close();
  }
});
