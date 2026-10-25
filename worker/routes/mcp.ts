import { inputSchemas } from "@core";
import type { Author } from "@core";
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
  createMcpHandler,
  isLegacyRequest,
} from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { z } from "zod";

import { ok } from "@lib/result";
import type { Failure, Result } from "@lib/result";

import { MEMORY_READ, MEMORY_WRITE } from "../lib/better-auth";
import type { Scope } from "../lib/better-auth";
import type { MemoryService } from "../services/memory";
import { recallInputSchema } from "../services/memory";
import type { AppEnv } from "../types";

const toolResult = <T>(value: Result<T, Failure>): CallToolResult =>
  value.ok
    ? { content: [{ text: JSON.stringify(value.value), type: "text" }] }
    : { content: [{ text: value.error.message, type: "text" }], isError: true };

const INSTRUCTIONS = `Memsys is long-term fragment memory.

Store durable information as small, atomic, self-contained fragments rather than summaries, transcripts, or reasoning traces. Keep fragments concise and split independent ideas into separate memories.

Use #anchors for stable entities or concepts that should link related fragments. Fragments with similar anchors are considered as associated and will be returned when recall.

Recall with short textual cues such as distinctive phrases, names, projects, concepts, or #anchors. A cue is free text and may combine several words, alternatives included: a memory matches when it contains any of them, and memories with more and rarer words come first. To search from another angle, call recall again with a different cue.`;

const createMcpServer = (
  memory: MemoryService,
  author: Author,
  scopes: ReadonlySet<Scope>,
  ownerInstructions: string
) => {
  const canRead = scopes.has(MEMORY_READ);
  const canWrite = scopes.has(MEMORY_WRITE);
  const server = new McpServer(
    { name: "memsys", version: "0.1.0" },
    {
      instructions: [INSTRUCTIONS, ownerInstructions.trim()]
        .filter(Boolean)
        .join("\n\n"),
    }
  );
  if (canWrite) {
    server.registerTool(
      "remember",
      {
        description:
          "Store one durable, independently recallable memory fragment. Keep it atomic, self-contained, and concise. Split multiple ideas into separate fragments. Use #anchors to link related memories.",
        inputSchema: inputSchemas.remember,
      },
      async (input) => toolResult(await memory.remember(input, author))
    );
  }
  if (canRead) {
    server.registerTool(
      "recall",
      {
        annotations: { readOnlyHint: true },
        description:
          "Recall memories using a short textual cue. Prefer distinctive phrases, entities, concepts, or #anchors. Fragments matching the cue come first; fragments with `via` were associated through the listed shared #anchors. `truncated: true` means some matching memories were left out: recall again with a more specific cue, or with an #anchor from `via`.",
        inputSchema: recallInputSchema,
      },
      async (input) => toolResult(ok(await memory.recall(input)))
    );
    server.registerTool(
      "list_tags",
      {
        annotations: { readOnlyHint: true },
        description: "List all #anchor names currently used.",
        inputSchema: z.object({}).strict(),
      },
      async () => toolResult(ok(await memory.listTags()))
    );
  }
  if (canWrite) {
    server.registerTool(
      "revise",
      {
        description:
          "Replace the full text of a known memory when its information has changed or needs correction. Keep the replacement atomic and self-contained.",
        inputSchema: inputSchemas.revise,
      },
      async (input) => toolResult(await memory.revise(input, author))
    );
    server.registerTool(
      "forget",
      {
        annotations: { destructiveHint: true },
        description:
          "Delete a known memory that is obsolete, incorrect, duplicated, or explicitly requested to be forgotten.",
        inputSchema: inputSchemas.forget,
      },
      async (input) => toolResult(await memory.forget(input, author))
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
  const author = c.get("author");
  const scopes = c.get("scopes");
  const { settings } = await memory.settings();
  const factory = () =>
    createMcpServer(memory, author, scopes, settings.instructions);
  if (await isLegacyRequest(c.req.raw)) {
    return await answerLegacyClientWithPlainJson(factory(), c.req.raw);
  }
  return await createMcpHandler(factory, { legacy: "reject" }).fetch(c.req.raw);
});
