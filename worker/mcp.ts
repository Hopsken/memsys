import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { RecallResult } from "../contract/memory";
import { plugins } from "../plugins";
import { MEMORY_READ, MEMORY_WRITE } from "./auth";
import type { Scope } from "./auth";
import { inputs } from "./memory";
import type { MemoryDO, WriteResult } from "./memory-do";

const error = (text: string): CallToolResult => ({
  content: [{ text, type: "text" }],
  isError: true,
});

const result = (
  value: WriteResult | RecallResult | { ref: string } | null
): CallToolResult => {
  if (value === null) {
    return error("Fragment not found");
  }
  if ("error" in value) {
    return error(value.error);
  }
  return { content: [{ text: JSON.stringify(value), type: "text" }] };
};

// Tools follow the caller's scopes: read-only tools need memory:read, the
// rest memory:write. A caller never sees a tool it cannot use.
export const createMcpServer = async (
  memory: DurableObjectStub<MemoryDO>,
  scopes: ReadonlySet<Scope>
) => {
  const canRead = scopes.has(MEMORY_READ);
  const canWrite = scopes.has(MEMORY_WRITE);
  const server = new McpServer(
    { name: "memsys", version: "0.1.0" },
    {
      instructions: `Memsys is long-term fragment memory.

Store durable information as small, atomic, self-contained fragments rather than summaries, transcripts, or reasoning traces. Keep fragments concise and split independent ideas into separate memories.

Use #anchors for stable entities or concepts that should link related fragments. Fragments with similar anchors are considered as associated and will be returned when recall.

Recall with short textual cues such as distinctive phrases, names, projects, or concepts. Try multiple cues when needed.`,
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
      async (input) => result(await memory.remember(input))
    );
  }
  if (canRead) {
    server.registerTool(
      "recall",
      {
        annotations: { readOnlyHint: true },
        description:
          "Recall memories using a short textual cue. Prefer distinctive phrases, entities, or concepts. Fragments matching the cue come first; fragments with `via` were associated through the listed shared #anchors.",
        inputSchema: inputs.recall,
      },
      async (input) => result(await memory.recall(input))
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
  }
  // Tool plugins enabled for this instance, within the caller's scopes.
  const enabled = new Set(await memory.enabledTools());
  for (const tool of plugins.flatMap((plugin) => plugin.tools ?? [])) {
    const allowed = tool.annotations?.readOnlyHint ? canRead : canWrite;
    if (allowed && enabled.has(tool.name)) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.input,
          ...(tool.annotations && { annotations: tool.annotations }),
        },
        async (input) => ({
          content: [
            { text: await memory.callTool(tool.name, input), type: "text" },
          ],
        })
      );
    }
  }
  return server;
};
