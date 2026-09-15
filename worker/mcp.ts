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
  const server = new McpServer(
    { name: "memsys", version: "0.1.0" },
    {
      instructions: `Memsys is long-term fragment memory.

Store durable information as small, atomic, self-contained fragments rather than summaries, transcripts, or reasoning traces. Keep fragments concise, around 140 characters when practical, and split independent ideas into separate memories.

Use #anchors for stable entities or concepts that should link related fragments. Anchors are links, not classifications.

Recall with short textual cues such as distinctive phrases, names, projects, or concepts. Try multiple cues when needed.`,
    }
  );
  server.registerTool(
    "remember",
    {
      description:
        "Store one durable, independently recallable memory fragment. Keep it atomic, self-contained, and concise. Split multiple ideas into separate fragments. Use #anchors to link related memories.",
      inputSchema: inputs.remember,
    },
    async (input) => result(await memory.remember(input))
  );
  server.registerTool(
    "recall",
    {
      annotations: { readOnlyHint: true },
      description:
        "Recall memories using a short textual cue. Prefer distinctive phrases, entities, or concepts. Related fragments may also be returned through shared #anchors.",
      inputSchema: inputs.recall,
    },
    async (input) => result(await memory.recall(input))
  );
  server.registerTool(
    "revise",
    {
      description:
        "Replace a known memory when its information has changed or needs correction. Keep the replacement atomic and self-contained.",
      inputSchema: inputs.revise,
    },
    async (input) => result(await memory.revise(input))
  );
  server.registerTool(
    "forget",
    {
      annotations: { destructiveHint: true },
      description:
        "Delete a known memory that is obsolete, incorrect, duplicated, or explicitly requested to be forgotten.",
      inputSchema: inputs.forget,
    },
    async (input) => result(await memory.forget(input))
  );
  return server;
};
