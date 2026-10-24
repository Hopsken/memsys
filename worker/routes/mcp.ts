import { inputs } from "@core";
import type { Memory } from "@core";
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
  createMcpHandler,
  isLegacyRequest,
} from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { z } from "zod";

import type { Author } from "@contract/memory";
import { ok } from "@contract/result";
import type { Result } from "@contract/result";

import { relevanceJudge } from "../clients/workers-ai";
import { MEMORY_READ, MEMORY_WRITE } from "../lib/better-auth";
import type { Scope } from "../lib/better-auth";
import { listTags, remember, revise } from "../services/memory";
import { recall, recallInput } from "../services/recall";
import type { AppEnv } from "../types";
import { problem } from "./problem";
import type { AppError } from "./problem";

// An error reads the same as over HTTP.
const result = <T>(value: Result<T, AppError>): CallToolResult =>
  value.ok
    ? { content: [{ text: JSON.stringify(value.value), type: "text" }] }
    : {
        content: [{ text: problem(value.error).body.error, type: "text" }],
        isError: true,
      };

// Tools follow the caller's scopes: read-only tools need memory:read, the
// rest memory:write. A caller never sees a tool it cannot use. Writes are
// recorded as the caller's.
const createMcpServer = (
  memory: Memory,
  scopes: ReadonlySet<Scope>,
  by: Author
) => {
  const canRead = scopes.has(MEMORY_READ);
  const canWrite = scopes.has(MEMORY_WRITE);
  const server = new McpServer(
    { name: "memsys", version: "0.1.0" },
    {
      instructions: `Memsys is long-term fragment memory.

Store durable information as small, atomic, self-contained fragments rather than summaries, transcripts, or reasoning traces. Keep fragments concise and split independent ideas into separate memories.

Use #anchors for stable entities or concepts that should link related fragments. Fragments with similar anchors are considered as associated and will be returned when recall.

Recall with short textual cues such as distinctive phrases, names, projects, concepts, or #anchors. A cue is free text and may combine several words, but every word must appear in a match, so extra words narrow the results. To search more broadly, call recall again with a different cue.`,
    }
  );
  if (canWrite) {
    server.registerTool(
      "remember",
      {
        description:
          "Store one durable, independently recallable memory fragment. Keep it atomic, self-contained, and concise. Split multiple ideas into separate fragments. Use #anchors to link related memories.",
        inputSchema: inputs.remember,
      },
      async (input) => result(await remember(memory, input, by))
    );
  }
  if (canRead) {
    server.registerTool(
      "recall",
      {
        annotations: { readOnlyHint: true },
        description:
          "Recall memories using a short textual cue. Prefer distinctive phrases, entities, concepts, or #anchors. Fragments matching the cue come first; fragments with `via` were associated through the listed shared #anchors. `truncated: true` means some matching memories were left out: recall again with a more specific cue, or with an #anchor from `via`.",
        inputSchema: recallInput,
      },
      async (input) =>
        result(await recall({ judge: relevanceJudge, memory }, input))
    );
    server.registerTool(
      "list_tags",
      {
        annotations: { readOnlyHint: true },
        description: "List all #anchor names currently used.",
        inputSchema: z.object({}).strict(),
      },
      async () => result(ok(await listTags(memory)))
    );
  }
  if (canWrite) {
    server.registerTool(
      "revise",
      {
        description:
          "Replace the full text of a known memory when its information has changed or needs correction. Keep the replacement atomic and self-contained.",
        inputSchema: inputs.revise,
      },
      async (input) => result(await revise(memory, input, by))
    );
    server.registerTool(
      "forget",
      {
        annotations: { destructiveHint: true },
        description:
          "Delete a known memory that is obsolete, incorrect, duplicated, or explicitly requested to be forgotten.",
        inputSchema: inputs.forget,
      },
      async (input) => result(await memory.forget(input, by))
    );
  }
  return server;
};

// Stateless MCP over Streamable HTTP, mounted at /mcp. Each request gets its
// own server bound to the caller's memory and scopes.
export const mcp = new Hono<AppEnv>().all("/", async (c) => {
  if (c.req.method !== "POST") {
    c.header("Allow", "POST");
    return c.json({ error: "Stateless MCP supports POST only" }, 405);
  }
  const memory = c.get("memory");
  const scopes = c.get("scopes");
  const by = c.get("by");
  const factory = () => createMcpServer(memory, scopes, by);
  if (!(await isLegacyRequest(c.req.raw))) {
    return await createMcpHandler(factory, { legacy: "reject" }).fetch(
      c.req.raw
    );
  }
  // 2025-era clients keep plain JSON responses; the SDK's built-in legacy
  // fallback would stream every response as SSE.
  const server = factory();
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
