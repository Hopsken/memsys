import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export const toolCallSchema = z.object({
  args: z.json(),
  isError: z.boolean(),
  name: z.string(),
  result: z.string(),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const piRunSchema = z.object({
  answer: z.string(),
  attempts: z.number(),
  cost: z.number(),
  error: z.string().optional(),
  tools: z.array(toolCallSchema),
});
export type PiRun = z.infer<typeof piRunSchema>;

const MCP_RESOURCE_TOOLS = "list_mcp_*,read_mcp_resource";

const blockSchema = z.looseObject({
  text: z.string().optional(),
  type: z.string(),
});
const texts = (blocks: z.infer<typeof blockSchema>[]) =>
  blocks
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("");

const eventSchema = z.discriminatedUnion("type", [
  z.object({
    args: z.json(),
    toolCallId: z.string(),
    toolName: z.string(),
    type: z.literal("tool_execution_start"),
  }),
  z.object({
    isError: z.boolean().default(false),
    result: z
      .looseObject({ content: z.array(blockSchema).default([]) })
      .nullish(),
    toolCallId: z.string(),
    toolName: z.string(),
    type: z.literal("tool_execution_end"),
  }),
  z.object({
    message: z.looseObject({
      content: z
        .union([
          z.string(),
          z.array(blockSchema).transform((blocks) => texts(blocks)),
        ])
        .default(""),
      errorMessage: z.string().optional(),
      role: z.string(),
      stopReason: z.string().optional(),
      thinkingLevel: z.string().optional(),
      usage: z.object({ cost: z.object({ total: z.number() }) }).optional(),
    }),
    type: z.literal("message_end"),
  }),
  z.object({ type: z.literal("agent_settled") }),
]);
type PiEvent = z.infer<typeof eventSchema>;
const KNOWN = new Set([
  "agent_settled",
  "message_end",
  "tool_execution_end",
  "tool_execution_start",
]);
const eventTypeSchema = z.looseObject({ type: z.string() });

const parseEvents = (stdout: string): PiEvent[] =>
  stdout
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => z.json().parse(JSON.parse(line)))
    .filter((json) => KNOWN.has(eventTypeSchema.parse(json).type))
    .map((json) => eventSchema.parse(json));

const summarize = (events: PiEvent[]) => {
  const starts = new Map<string, PiEvent & { type: "tool_execution_start" }>();
  const tools: ToolCall[] = [];
  const errors: string[] = [];
  let answer = "";
  let cost = 0;
  let settled = false;
  let thinking: string | undefined;
  for (const item of events) {
    if (item.type === "tool_execution_start") {
      starts.set(item.toolCallId, item);
    } else if (item.type === "tool_execution_end") {
      tools.push({
        args: starts.get(item.toolCallId)?.args ?? null,
        isError: item.isError,
        name: item.toolName.replace(/^mcp__memsys__/u, ""),
        result: texts(item.result?.content ?? []),
      });
    } else if (
      item.type === "message_end" &&
      item.message.role === "assistant"
    ) {
      const { content, errorMessage, stopReason, thinkingLevel, usage } =
        item.message;
      cost += usage?.cost.total ?? 0;
      thinking = thinkingLevel ?? thinking;
      answer = content || answer;
      if (stopReason === "error") {
        errors.push(errorMessage ?? "assistant error");
      }
    } else if (item.type === "agent_settled") {
      settled = true;
    }
  }
  return { answer, cost, errors, settled, thinking, tools };
};

export interface PiOptions {
  dir: string;
  mcpUrl: string;
  model: string;
  prompt: string;
  recallBudget?: number;
  stdin: string;
  system: string;
  thinking: string;
}

export const READ_TOOLS = new Set(["list_tags", "recall"]);

const runOnce = async (
  options: PiOptions
): Promise<Omit<PiRun, "attempts">> => {
  await mkdir(options.dir, { recursive: true });
  const readOnly = options.recallBudget !== undefined;
  await writeFile(
    path.join(options.dir, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        memsys: readOnly
          ? {
              exposure: "hidden",
              toolExposure: { list_tags: "direct", recall: "direct" },
              url: options.mcpUrl,
            }
          : { exposure: "direct", url: options.mcpUrl },
      },
    })
  );
  const child = spawn(
    "pi",
    [
      "--mode",
      "json",
      "--print",
      "--no-session",
      "--no-builtin-tools",
      "--no-context-files",
      "--no-skills",
      "--no-prompt-templates",
      "--no-extensions",
      "-e",
      "builtin:mcp",
      ...(readOnly ? ["-e", path.join(import.meta.dirname, "budget.ts")] : []),
      "--exclude-tools",
      MCP_RESOURCE_TOOLS,
      "--model",
      options.model,
      "--thinking",
      options.thinking,
      "--append-system-prompt",
      options.system,
      options.prompt,
    ],
    {
      cwd: options.dir,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: options.dir,
        RECALL_ROUNDS: String(options.recallBudget ?? ""),
      },
    }
  );
  child.stdin.end(options.stdin);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const [code]: unknown[] = await once(child, "close");
  const { answer, cost, errors, settled, thinking, tools } = summarize(
    parseEvents(stdout)
  );
  if (thinking !== undefined && thinking !== options.thinking) {
    throw new Error(
      `${options.model} ran at thinking ${thinking}, not ${options.thinking}; pick a level the provider has`
    );
  }
  const failed = code !== 0 || !settled || errors.length > 0;
  const detail = [...errors, stderr.trim().slice(-500)]
    .filter(Boolean)
    .join("\n");
  return {
    answer,
    cost,
    tools,
    ...(failed && { error: `exit ${String(code)}: ${detail}` }),
  };
};

const ATTEMPTS = 3;

export const runPi = async (options: PiOptions): Promise<PiRun> => {
  let result = await runOnce(options);
  let attempts = 1;
  while (result.error !== undefined && attempts < ATTEMPTS) {
    attempts += 1;
    // oxlint-disable-next-line no-await-in-loop
    result = await runOnce(options);
  }
  return { ...result, attempts };
};
