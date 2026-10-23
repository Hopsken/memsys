// The dev Worker the harness talks to (vite.config.ts, :5174): throwaway
// memory spaces behind /__dev/eval/:space, with MCP, export, and import.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { z } from "zod";

export const SERVER = process.env["MEMSYS_URL"] ?? "http://127.0.0.1:5174";

export const server = async (route: string, init?: RequestInit) => {
  const response = await fetch(`${SERVER}/__dev/eval/${route}`, init);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${route}: ${response.status} ${body}`);
  }
  return body;
};

// One MCP JSON-RPC call to a space; params are the method's own object.
const rpc = async (
  space: string,
  method: string,
  params: Record<string, z.core.util.JSONType>
) => {
  const body = await server(`${space}/mcp`, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  // The reply may come as one SSE event.
  const json = body.startsWith("{") ? body : (body.split("data: ")[1] ?? "");
  return z.object({ result: z.json() }).parse(JSON.parse(json)).result;
};

// Pi shows MCP server instructions only as one line, and not at all for tools
// it declares directly. Claude Code puts them in the system prompt, so the
// harness does the same, read live so edits to worker/mcp.ts take effect.
export const serverInstructions = async () =>
  z.object({ instructions: z.string() }).parse(
    await rpc("instructions", "initialize", {
      capabilities: {},
      clientInfo: { name: "longmemeval", version: "0" },
      protocolVersion: "2025-06-18",
    })
  ).instructions;

// Tool name → description, as the agent sees them.
export const toolDescriptions = async () =>
  Object.fromEntries(
    z
      .object({
        tools: z.array(
          z.object({ description: z.string().default(""), name: z.string() })
        ),
      })
      .parse(await rpc("instructions", "tools/list", {}))
      .tools.map((tool) => [tool.name, tool.description])
  );

// A record as /export writes it; other fields pass through to /import.
export const logRecord = z.looseObject({
  at: z.string(),
  fragment: z.string().nullable(),
  ref: z.string(),
});
export type LogRecord = z.infer<typeof logRecord>;

export const readLines = async <T>(
  file: string,
  schema: z.ZodType<T>
): Promise<T[]> => {
  if (!existsSync(file)) {
    return [];
  }
  const text = await readFile(file, "utf-8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => schema.parse(JSON.parse(line)));
};

export const readJson = async <T>(
  file: string,
  schema: z.ZodType<T>
): Promise<T> => schema.parse(JSON.parse(await readFile(file, "utf-8")));

export const exportLog = async (space: string) => {
  const text = await server(`${space}/export`);
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => logRecord.parse(JSON.parse(line)));
};

// Import takes whole refs, and the dev server limits bodies to 32 KB.
export const importLog = async (space: string, records: LogRecord[]) => {
  const chunks = [""];
  for (const group of Object.values(Object.groupBy(records, (r) => r.ref))) {
    const lines = (group ?? [])
      .map(({ session: _, ...record }) => `${JSON.stringify(record)}\n`)
      .join("");
    if ((chunks.at(-1) ?? "").length + lines.length > 24_000) {
      chunks.push("");
    }
    chunks[chunks.length - 1] += lines;
  }
  for (const body of chunks.filter(Boolean)) {
    // Chunks go in order.
    // oxlint-disable-next-line no-await-in-loop
    await server(`${space}/import`, { body, method: "POST" });
  }
};

// The fragments in force after replaying a log, by ref.
export const currentMemories = (records: LogRecord[]) => {
  const memories = new Map<string, string>();
  for (const { fragment, ref } of records) {
    if (fragment === null) {
      memories.delete(ref);
    } else {
      memories.set(ref, fragment);
    }
  }
  return memories;
};

export const pool = async <T>(
  items: T[],
  size: number,
  task: (item: T) => Promise<void>
) => {
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      // Each worker takes one item at a time.
      // oxlint-disable-next-line no-await-in-loop
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
};
