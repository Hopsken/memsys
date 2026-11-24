import type { Source } from "@core";
import { Agent } from "@earendil-works/pi-agent-core";
import type {
  AgentTool,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { obj, str } from "@earendil-works/pi-schema";

import { err, ok } from "@lib/result";
import type { Failure, Result } from "@lib/result";

import { memoryUnavailable } from "../../errors";
import type { MemoryUnavailable } from "../../errors";
import type { MemoryService } from "./index";
import {
  formatSource,
  noteMessage,
  personaNames,
  prepareSystemPrompt,
  recallMessage,
} from "./prompt";
import { createProvider } from "./provider";

export const MODEL_PROVIDER = "deepseek";
export const MODEL_ID = "deepseek-flash";
export const THINKING = "high";
export const EMPTY_ANSWER = "I don't have any memories yet.";

const ALLOW: BeforeToolCallResult = {};

export const MAX_NOTE_TURNS = 8;
export const MAX_NOTE_WRITES = 10;
export const MAX_NOTE_FORGETS = 3;

const FRAGMENT_PARAMETER =
  "One short memory, a few sentences at most, that stands alone in words a later question would use.";

const TOOL_DECLARATIONS = [
  {
    description:
      "Store one memory that no other source keeps: something the person said, chose, prefers, decided, or learned. One idea per memory.",
    label: "Remember",
    name: "remember",
    parameters: obj({
      fragment: str({ description: FRAGMENT_PARAMETER }),
    }),
  },
  {
    description:
      "Replace a memory, by ref, when it is wrong or outdated. Keep what still holds and say what changed.",
    label: "Revise",
    name: "revise",
    parameters: obj({
      fragment: str({ description: FRAGMENT_PARAMETER }),
      ref: str({
        description: "The ref in square brackets on the memory to replace.",
      }),
    }),
  },
  {
    description:
      "Delete a memory by ref when it is wrong beyond revising, a duplicate, or the person asked to forget it.",
    label: "Forget",
    name: "forget",
    parameters: obj({
      ref: str({
        description: "The ref in square brackets on the memory to delete.",
      }),
    }),
  },
] as const;

interface Counts {
  forgotten: number;
  remembered: number;
  revised: number;
}

const noCounts = (): Counts => ({ forgotten: 0, remembered: 0, revised: 0 });

const writeCount = ({ remembered, revised }: Counts) => remembered + revised;

const receipt = (counts: Counts) => {
  const parts = [
    counts.remembered > 0 &&
      `remembered ${counts.remembered} ${counts.remembered === 1 ? "memory" : "memories"}`,
    counts.revised > 0 &&
      `revised ${counts.revised} ${counts.revised === 1 ? "memory" : "memories"}`,
    counts.forgotten > 0 &&
      `forgot ${counts.forgotten} ${counts.forgotten === 1 ? "memory" : "memories"}`,
  ].filter(Boolean);
  return parts.length === 0
    ? "No memories changed."
    : `Memory updated: ${parts.join(", ")}.`;
};

export const failed = (cause: string, counts?: Counts): MemoryUnavailable =>
  memoryUnavailable(
    !/api key|unauthori[sz]ed|401|403/iu.test(cause),
    counts && writeCount(counts) + counts.forgotten > 0
      ? receipt(counts)
      : undefined
  );

export const textOf = (message: AssistantMessage) =>
  message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();

export const errorOf = (message: AssistantMessage | undefined) =>
  message?.role === "assistant" && message.stopReason === "error"
    ? message.errorMessage
    : undefined;

interface Runner {
  model: Model<string>;
  stream: (
    model: Model<string>,
    context: TranscriptContext,
    options?: SimpleStreamOptions
  ) => AssistantMessageEventStream;
}

export const createRunner = (
  apiKey: string,
  baseUrl?: string
): Runner | null => {
  const models = createModels({
    authContext: {
      env: (name) =>
        Promise.resolve(name === "DEEPSEEK_API_KEY" ? apiKey : undefined),
      fileExists: () => Promise.resolve(false),
    },
  });
  models.setProvider(createProvider(baseUrl));
  const model = models.getModel(MODEL_PROVIDER, MODEL_ID);
  return model ? { model, stream: models.streamSimple.bind(models) } : null;
};

interface RunOptions {
  beforeToolCall?: ConstructorParameters<typeof Agent>[0]["beforeToolCall"];
  finishTurn?: ConstructorParameters<typeof Agent>[0]["finishTurn"];
  message: string;
  signal?: AbortSignal;
  system: string;
  toolChoice: "auto" | "none";
  tools: AgentTool[];
}

export const run = async (subject: Runner, options: RunOptions) => {
  const agent = new Agent({
    initialState: {
      model: subject.model,
      systemPrompt: options.system,
      thinkingLevel: THINKING,
      tools: options.tools,
    },
    streamFn: (model, context, streamOptions) =>
      subject.stream(model, context, {
        ...streamOptions,
        toolChoice: options.toolChoice,
      }),
    toolExecution: "sequential",
    ...(options.beforeToolCall && {
      beforeToolCall: options.beforeToolCall,
    }),
    ...(options.finishTurn && { finishTurn: options.finishTurn }),
  });
  options.signal?.addEventListener("abort", () => agent.abort());
  await agent.prompt(options.message);
  return agent.state.messages.findLast(
    (message) => message.role === "assistant"
  );
};

export const toolResult = (text: string, isError = false) => ({
  content: [{ text, type: "text" as const }],
  details: undefined,
  ...(isError && { isError: true }),
});

export class Subagent {
  readonly #apiKey: string;
  readonly #baseUrl: string | undefined;
  readonly #memory: MemoryService;

  constructor(memory: MemoryService, apiKey: string, baseUrl?: string) {
    this.#memory = memory;
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl;
  }

  async recall(
    context: string,
    source: Source
  ): Promise<Result<{ answer: string }, MemoryUnavailable>> {
    if ((await this.#memory.count()) === 0) {
      return ok({ answer: EMPTY_ANSWER });
    }
    const subject = createRunner(this.#apiKey, this.#baseUrl);
    if (!subject) {
      return err(failed("The DeepSeek model is not available"));
    }
    const [{ settings }, personas] = await Promise.all([
      this.#memory.settings(),
      this.#memory.personas(),
    ]);
    const names = personaNames(personas);
    try {
      const last = await run(subject, {
        message: recallMessage(context, formatSource(source, names)),
        system: await prepareSystemPrompt(
          this.#memory,
          settings.instructions,
          names
        ),
        toolChoice: "none",
        tools: TOOL_DECLARATIONS.map((declaration) => ({
          ...declaration,
          execute: () => Promise.reject(new Error("Recall does not write")),
        })),
      });
      const failure = errorOf(last);
      if (failure !== undefined) {
        return err(failed(failure));
      }
      const answer = last ? textOf(last) : "";
      return answer === ""
        ? err(failed("The model returned an empty answer"))
        : ok({ answer });
    } catch (error) {
      return err(
        failed(error instanceof Error ? error.message : String(error))
      );
    }
  }

  async note(
    context: string,
    source: Source
  ): Promise<Result<{ receipt: string }, Failure | MemoryUnavailable>> {
    const subject = createRunner(this.#apiKey, this.#baseUrl);
    if (!subject) {
      return err(failed("The DeepSeek model is not available"));
    }
    const [{ settings }, personas] = await Promise.all([
      this.#memory.settings(),
      this.#memory.personas(),
    ]);
    const names = personaNames(personas);
    const counts = noCounts();
    const store = async (
      name: "remember" | "revise",
      input: { fragment: string; ref: string | undefined }
    ) =>
      name === "remember"
        ? await this.#memory.remember({ fragment: input.fragment }, source)
        : await this.#memory.revise(
            { fragment: input.fragment, ref: input.ref ?? "" },
            source
          );
    const tools: AgentTool[] = TOOL_DECLARATIONS.map((declaration) => ({
      ...declaration,
      execute: async (_toolCallId, params) => {
        // SAFETY: the agent validates every call against this tool's schema.
        const input = params as { fragment?: string; ref?: string };
        if (declaration.name === "forget") {
          const deleted = await this.#memory.forget(
            { ref: input.ref ?? "" },
            source
          );
          if (!deleted.ok) {
            return toolResult(deleted.error.message, true);
          }
          counts.forgotten += 1;
          return toolResult(`Forgot ${deleted.value.ref}.`);
        }
        const stored = await store(declaration.name, {
          fragment: input.fragment ?? "",
          ref: input.ref,
        });
        if (!stored.ok) {
          return toolResult(stored.error.message, true);
        }
        if (declaration.name === "remember") {
          counts.remembered += 1;
        } else {
          counts.revised += 1;
        }
        const warnings =
          "warnings" in stored.value ? (stored.value.warnings ?? []) : [];
        return toolResult(
          `${declaration.name === "remember" ? "Stored" : "Revised"} ${stored.value.ref}.${warnings.length > 0 ? ` ${warnings.join(" ")}` : ""}`
        );
      },
    }));
    let turns = 0;
    try {
      const last = await run(subject, {
        beforeToolCall: ({ toolCall }) => {
          if (
            toolCall.name === "forget" &&
            counts.forgotten >= MAX_NOTE_FORGETS
          ) {
            return Promise.resolve({
              block: true,
              reason: "This call has reached its forget limit.",
            });
          }
          if (
            toolCall.name !== "forget" &&
            writeCount(counts) >= MAX_NOTE_WRITES
          ) {
            return Promise.resolve({
              block: true,
              reason: "This call has reached its write limit.",
            });
          }
          return Promise.resolve(ALLOW);
        },
        finishTurn: () => {
          turns += 1;
          return turns >= MAX_NOTE_TURNS
            ? { action: "end" as const }
            : undefined;
        },
        message: noteMessage(context, formatSource(source, names)),
        system: await prepareSystemPrompt(
          this.#memory,
          settings.instructions,
          names
        ),
        toolChoice: "auto",
        tools,
      });
      const failure = errorOf(last);
      if (failure !== undefined) {
        return err(failed(failure, counts));
      }
      return ok({ receipt: receipt(counts) });
    } catch (error) {
      return err(
        failed(error instanceof Error ? error.message : String(error), counts)
      );
    }
  }
}
