import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { inputs } from "./memory";
import type { MemoryDO } from "./memory-do";

const result = (
  value: ReturnType<MemoryDO["remember" | "recall" | "revise" | "forget"]>
): CallToolResult => {
  if (value === null) {
    return {
      content: [{ text: "Fragment not found", type: "text" }],
      isError: true,
    };
  }
  if ("error" in value) {
    return {
      content: [{ text: value.error, type: "text" }],
      isError: true,
    };
  }
  return { content: [{ text: JSON.stringify(value), type: "text" }] };
};

export const createMcpServer = (memory: DurableObjectStub<MemoryDO>) => {
  const server = new McpServer({ name: "memsys", version: "0.1.0" });
  server.registerTool(
    "remember",
    {
      description:
        "Store one atomic text fragment. Add #anchors to associate memories.",
      inputSchema: inputs.remember,
    },
    async (input) => result(await memory.remember(input))
  );
  server.registerTool(
    "recall",
    {
      annotations: { readOnlyHint: true },
      description:
        "Find a case-insensitive phrase, then related fragments with exact shared #anchors. Returns at most 20 of each, newest updated first.",
      inputSchema: inputs.recall,
    },
    async (input) => result(await memory.recall(input))
  );
  server.registerTool(
    "revise",
    {
      description:
        "Revise a known fragment by ref. old_string must match exactly, including case and whitespace. By default it must match once; set replaceAll to true to replace all non-overlapping matches. new_string is literal text and may be empty to delete matches. The resulting fragment must be non-blank and at most 280 characters (Unicode grapheme clusters); above 140 returns a warning. Returns the full updated fragment. Anchors follow the new text.",
      inputSchema: inputs.revise,
    },
    async (input) => result(await memory.revise(input))
  );
  server.registerTool(
    "forget",
    {
      annotations: { destructiveHint: true },
      description: "Delete a known fragment by ref.",
      inputSchema: inputs.forget,
    },
    async (input) => result(await memory.forget(input))
  );
  return server;
};
