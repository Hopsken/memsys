import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { openMemory } from "../worker/memory";
import { faux } from "./faux-provider";
import { scripted, useFauxModel } from "./subagent";

const blockSchema = z.union([
  z.object({ text: z.string(), type: z.literal("text") }),
  z.object({
    data: z.string(),
    mimeType: z.string(),
    type: z.literal("image"),
  }),
]);

const recordSchema = z.object({ ref: z.string().optional() });

type Block = z.output<typeof blockSchema>;

const blockText = (block: Block) =>
  block.type === "text" ? block.text : "[image]";

const contentText = (content: string | Block[]) => {
  const text = z.string().safeParse(content);
  return text.success
    ? text.data
    : z.array(blockSchema).parse(content).map(blockText).join("\n");
};

type AssistantBlock = AssistantMessage["content"][number];

const assistantText = (content: readonly AssistantBlock[]) =>
  content
    .map((block) => {
      if (block.type === "toolCall") {
        return `toolCall ${block.name} ${JSON.stringify(block.arguments)}`;
      }
      return block.type === "thinking"
        ? `thinking: ${block.thinking}`
        : block.text;
    })
    .join("\n");

const messageText = (message: Message) => {
  switch (message.role) {
    case "system":
    case "user": {
      return contentText(message.content);
    }
    case "assistant": {
      return assistantText(message.content);
    }
    default: {
      return `${message.toolName}: ${message.content
        .map((block) => blockText(block))
        .join("\n")}`;
    }
  }
};

const render = (messages: readonly Message[]) =>
  messages
    .map((message) => `${message.role}:\n${messageText(message)}`)
    .join("\n\n");

const refsIn = (log: string) => {
  const refs = new Set<string>();
  for (const line of log.trimEnd().split("\n")) {
    const record = recordSchema.parse(JSON.parse(line));
    if (record.ref) {
      refs.add(record.ref);
    }
  }
  return [...refs];
};

describe("Scripted subagent run", () => {
  useFauxModel();

  it("keeps a reviewable trace of a recall and a note", async () => {
    const memory = openMemory("artifact");
    const preference = await memory.remember(
      { fragment: "Prefers pnpm over npm" },
      "user"
    );
    const duplicate = await memory.remember(
      { fragment: "Uses npm for this one old repo" },
      "agent:Laptop script"
    );
    const agent = await memory.remember(
      { fragment: "Deploys run through wrangler" },
      "agent:Laptop script"
    );
    if (!preference.ok || !duplicate.ok || !agent.ok) {
      throw new Error("Seeding failed");
    }

    const script = scripted();
    faux.setResponses([
      script.text("You prefer pnpm over npm. Deploys run through wrangler."),
    ]);
    const recalled = await memory.recall({
      context:
        "Which package manager does this person prefer, and how do deploys run?",
    });

    faux.setResponses([
      script.tool("remember", { fragment: "Lives in Singapore" }),
      script.tool("revise", {
        fragment: "Prefers pnpm; npm only for the one old repo",
        ref: preference.value.ref,
      }),
      script.tool("forget", { ref: duplicate.value.ref }),
      script.text("Remembered the city and updated two preferences."),
    ]);
    const noted = await memory.note(
      {
        context:
          "I live in Singapore now. I still prefer pnpm, and npm is only for that one old repo.",
      },
      "agent:Laptop script"
    );
    if (!noted.ok || !recalled.ok) {
      throw new Error("The scripted run failed");
    }

    const [recallRequest, ...noteRequests] = script.requests;
    if (!recallRequest) {
      throw new Error("No recall request was captured");
    }
    const [recallSystem, recallUser] = recallRequest.context.messages;
    if (recallSystem?.role !== "system" || recallUser?.role !== "user") {
      throw new Error("Unexpected recall transcript");
    }

    const noteLines: string[] = [];
    let shown = 0;
    for (const request of noteRequests) {
      const { messages } = request.context;
      if (shown === 0) {
        noteLines.push(render(messages.slice(0, 2)));
        shown = Math.min(2, messages.length);
      }
      const fresh = render(messages.slice(shown));
      if (fresh !== "") {
        noteLines.push(fresh);
      }
      shown = messages.length;
    }

    const log = await memory.exportLog({ history: true });
    const placeholders = new Map(
      refsIn(log).map((ref, index): [string, string] => [
        ref,
        `<ref-${index + 1}>`,
      ])
    );
    const stable = (value: string) => {
      let result = value.replaceAll(/\d{4}-\d\d-\d\dT[\d:.]+Z/gu, "<time>");
      for (const [ref, name] of placeholders) {
        result = result.replaceAll(ref, name);
      }
      return result;
    };

    const trace = [
      "# Scripted recall and note run",
      "",
      "## System prompt (shared by both calls)",
      stable(messageText(recallSystem)),
      "",
      "## Recall",
      "### Model input",
      stable(messageText(recallUser)),
      "### Answer",
      recalled.value.answer,
      "",
      "## Note",
      "### Model input",
      stable(noteLines.shift() ?? ""),
      ...noteLines.flatMap((line, index) => [
        `### After turn ${index + 1}`,
        stable(line),
      ]),
      "### Receipt",
      noted.value.receipt,
      "",
      "## Memory log after the run",
      stable(log).trimEnd(),
      "",
    ].join("\n");

    await expect(trace).toMatchFileSnapshot("./artifacts/subagent.txt");
  });
});
