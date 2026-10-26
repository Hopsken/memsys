import { fragmentTextSchema, inputSchemas } from "@core";
import type { Author, Fragment } from "@core";
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
import {
  recallContextSchema,
  recallCuesSchema,
  recallInputSchema,
} from "../services/memory";
import type { AppEnv } from "../types";
import { SERVER_INSTRUCTIONS, TOOLS } from "./mcp-prompts";

const toolResult = <T>(value: Result<T, Failure>): CallToolResult =>
  value.ok
    ? { content: [{ text: JSON.stringify(value.value), type: "text" }] }
    : { content: [{ text: value.error.message, type: "text" }], isError: true };

// Agents see an author only when the user vouches for it: the user, or a
// persona by its current name. An `agent:<name>` is whatever the client calls
// itself, so showing it would let one agent speak to the others.
const vouchedAuthorNames = async (memory: MemoryService) => {
  const personas = await memory.personas();
  return new Map<Author, string>([
    ["user", "user"],
    ...personas.map((persona): [Author, string] => [
      `persona:${persona.id}`,
      persona.name,
    ]),
  ]);
};

const forAgents = <T extends Fragment>(
  { by, ...fragment }: T,
  names: ReadonlyMap<Author, string>
) => {
  const name = by === null ? undefined : names.get(by);
  return name === undefined ? fragment : { ...fragment, by: name };
};

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
      instructions: [SERVER_INSTRUCTIONS, ownerInstructions.trim()]
        .filter(Boolean)
        .join("\n\n"),
    }
  );
  if (canWrite) {
    server.registerTool(
      "remember",
      {
        description: TOOLS.remember.description,
        inputSchema: inputSchemas.remember.extend({
          fragment: fragmentTextSchema.describe(
            TOOLS.remember.parameters.fragment
          ),
        }),
      },
      async (input) => {
        const written = await memory.remember(input, author);
        const names = await vouchedAuthorNames(memory);
        return toolResult(
          written.ok ? ok(forAgents(written.value, names)) : written
        );
      }
    );
  }
  if (canRead) {
    server.registerTool(
      "recall",
      {
        annotations: { readOnlyHint: true },
        description: TOOLS.recall.description,
        inputSchema: recallInputSchema.extend({
          context: recallContextSchema.describe(
            TOOLS.recall.parameters.context
          ),
          cues: recallCuesSchema.describe(TOOLS.recall.parameters.cues),
        }),
      },
      async (input) => {
        const [recalled, names] = await Promise.all([
          memory.recall(input),
          vouchedAuthorNames(memory),
        ]);
        return toolResult(
          recalled.ok
            ? ok({
                ...recalled.value,
                fragments: recalled.value.fragments.map((item) =>
                  forAgents(item, names)
                ),
              })
            : recalled
        );
      }
    );
    server.registerTool(
      "list_tags",
      {
        annotations: { readOnlyHint: true },
        description: TOOLS.list_tags.description,
        inputSchema: z.object({}).strict(),
      },
      async () => toolResult(ok(await memory.listTags()))
    );
  }
  if (canWrite) {
    server.registerTool(
      "revise",
      {
        description: TOOLS.revise.description,
        inputSchema: inputSchemas.revise.extend({
          fragment: fragmentTextSchema.describe(
            TOOLS.revise.parameters.fragment
          ),
        }),
      },
      async (input) => {
        const written = await memory.revise(input, author);
        const names = await vouchedAuthorNames(memory);
        return toolResult(
          written.ok ? ok(forAgents(written.value, names)) : written
        );
      }
    );
    server.registerTool(
      "forget",
      {
        annotations: { destructiveHint: true },
        description: TOOLS.forget.description,
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
