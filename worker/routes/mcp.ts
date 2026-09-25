import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";

import type { AppEnv } from "../auth";
import { createMcpServer } from "../mcp";

// Stateless MCP over Streamable HTTP, mounted at /mcp.
export const mcp = new Hono<AppEnv>().all("/", async (c) => {
  if (c.req.method !== "POST") {
    c.header("Allow", "POST");
    return c.json({ error: "Stateless MCP supports POST only" }, 405);
  }
  const server = await createMcpServer(c.get("memory"), c.get("scopes"));
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
