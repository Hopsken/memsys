// Pi extension for the recall phase: refuses every recall past the budget in
// RECALL_ROUNDS, so "ask until the memory is empty" cannot count as a win.
// The model sees the reason as a tool error and is told to answer.

export const BUDGET_REASON = "Recall budget of";

interface ToolCallEvent {
  toolName: string;
}
interface Block {
  block: true;
  reason: string;
}
interface Pi {
  on: (
    event: "tool_call",
    handler: (event: ToolCallEvent) => Block | undefined
  ) => void;
}

export default function budget(pi: Pi) {
  const max = Number(process.env["RECALL_ROUNDS"] || "5");
  let used = 0;
  pi.on("tool_call", (event) => {
    if (event.toolName === "mcp__memsys__recall") {
      used += 1;
    }
    if (event.toolName === "mcp__memsys__recall" && used > max) {
      return {
        block: true,
        reason: `${BUDGET_REASON} ${max} calls is used up. Answer with what you already have.`,
      };
    }
    // Pi runs the call.
    // oxlint-disable-next-line no-useless-undefined
    return undefined;
  });
}
