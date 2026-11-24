import type { Source } from "@core";
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
  createMcpHandler,
  isLegacyRequest,
} from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { z } from "zod";

import type { Failure, Result } from "@lib/result";

import { MEMORY_READ, MEMORY_WRITE } from "../lib/better-auth";
import type { Scope } from "../lib/better-auth";
import type { MemoryService } from "../services/memory";
import { memoryContextSchema } from "../services/memory";
import type { AppEnv } from "../types";
import { SERVER_INSTRUCTIONS, TOOLS } from "./mcp-prompts";

const prose = <T extends { answer?: string; receipt?: string }>(
  value: Result<T, Failure>
): CallToolResult =>
  value.ok
    ? {
        content: [
          {
            text: value.value.answer ?? value.value.receipt ?? "",
            type: "text",
          },
        ],
      }
    : { content: [{ text: value.error.message, type: "text" }], isError: true };

const createMcpServer = (
  memory: MemoryService,
  source: Source,
  scopes: ReadonlySet<Scope>
) => {
  const server = new McpServer(
    { name: "memsys", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS }
  );
  if (scopes.has(MEMORY_READ)) {
    server.registerTool(
      "recall",
      {
        annotations: { readOnlyHint: true },
        description: TOOLS.recall.description,
        inputSchema: z
          .object({
            context: memoryContextSchema.describe(
              TOOLS.recall.parameters.context
            ),
          })
          .strict(),
      },
      async (input) => prose(await memory.recall(input, source))
    );
  }
  if (scopes.has(MEMORY_WRITE)) {
    server.registerTool(
      "note",
      {
        annotations: { destructiveHint: true },
        description: TOOLS.note.description,
        inputSchema: z
          .object({
            context: memoryContextSchema.describe(
              TOOLS.note.parameters.context
            ),
          })
          .strict(),
      },
      async (input) => prose(await memory.note(input, source))
    );
  }
  return server;
};

const answerLegacyClientWithPlainJson = async (
  server: McpServer,
  request: Request
) => {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
};

export const mcp = new Hono<AppEnv>().all("/", async (c) => {
  if (c.req.method !== "POST") {
    c.header("Allow", "POST");
    return c.json({ error: "Stateless MCP supports POST only" }, 405);
  }
  const memory = c.get("memory");
  const source = c.get("source");
  const scopes = c.get("scopes");
  const factory = () => createMcpServer(memory, source, scopes);
  if (await isLegacyRequest(c.req.raw)) {
    return await answerLegacyClientWithPlainJson(factory(), c.req.raw);
  }
  return await createMcpHandler(factory, { legacy: "reject" }).fetch(c.req.raw);
});
