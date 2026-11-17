import type { Fragment } from "@core";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import type { Static } from "@earendil-works/pi-schema";
import { env } from "cloudflare:workers";

import { fragmentLength } from "@lib/fragment";
import { err, ok } from "@lib/result";
import type { Result } from "@lib/result";

import type { MemoryUnavailable } from "../errors";
import type { MemoryService } from "../services/memory";
import { prepareSystemPrompt } from "../services/memory/prompt";
import {
  createRunner,
  errorOf,
  failed,
  run,
  textOf,
  toolResult,
} from "../services/memory/subagent";
import type { Change, Proposal } from "./model";

export const MAX_PROPOSALS = 30;
export const MAX_TURNS = 8;
const MAX_CHANGES_PER_PROPOSAL = 5;

const TAIL = `Review the whole memory above as its maintainer. Propose changes only for concrete defects: duplicates, contradictions, memories that a later one made outdated, time-bound memories whose time has passed, an agent's suggestion recorded as the person's decision, copied source material that should be a conclusion plus where to find it, and memories that hold more than one idea.

Each propose_change call is one proposal that the person accepts or rejects as a whole. Put changes that depend on each other in one proposal, such as revising one memory and forgetting its duplicate, or revising a memory and adding the idea split from it. Keep each memory to one short idea, in words a later question would use. Do not add inferences or summaries that no memory states. Give each proposal a one-sentence reason addressed to the person.

When memory needs no change, propose nothing. Finish with one short sentence about what you found.`;

const PROPOSE_CHANGE = {
  description:
    "Propose one change for the person to review: one or more edits to memory that they accept or reject together. Nothing changes until they accept it.",
  label: "Propose change",
  name: "propose_change",
  parameters: obj({
    changes: arr(
      obj({
        fragment: opt(
          str({
            description:
              "For remember and revise: the full new memory text, one short idea.",
          })
        ),
        ref: opt(
          str({
            description:
              "For revise and forget: the ref in square brackets on the memory to change.",
          })
        ),
        type: oneOf(["remember", "revise", "forget"]),
      }),
      { maxItems: MAX_CHANGES_PER_PROPOSAL, minItems: 1 }
    ),
    reason: str({
      description: "One sentence telling the person why, in plain words.",
      minLength: 1,
    }),
  }),
} as const;

type ChangeInput = Static<typeof PROPOSE_CHANGE.parameters>["changes"][number];

const describeChange = (
  input: ChangeInput,
  current: ReadonlyMap<string, Fragment>,
  claimed: ReadonlySet<string>,
  refuse: number
): Result<Change, string> => {
  const fragment = input.fragment?.trim();
  if (input.type === "forget" ? fragment !== undefined : !fragment) {
    return err(
      input.type === "forget"
        ? "A forget takes no text."
        : `A ${input.type} needs the new memory text.`
    );
  }
  if (fragment !== undefined && fragmentLength(fragment) > refuse) {
    return err(
      `The new text has ${fragmentLength(fragment)} characters, above the limit of ${refuse}.`
    );
  }
  if (input.type === "remember") {
    return input.ref === undefined && fragment !== undefined
      ? ok({ fragment, type: "remember" })
      : err("A remember takes no ref.");
  }
  if (input.ref === undefined) {
    return err(`A ${input.type} needs the ref of the memory it changes.`);
  }
  const target = current.get(input.ref);
  if (!target) {
    return err(`No current memory has the ref ${input.ref}.`);
  }
  if (claimed.has(input.ref)) {
    return err(
      `Another change already covers ${input.ref}. Put each memory in one proposal only.`
    );
  }
  const before = {
    at: target.at,
    current: target.fragment,
    ref: input.ref,
    source: target.source,
  };
  if (input.type === "forget") {
    return ok({ ...before, type: "forget" });
  }
  if (fragment === undefined || fragment === target.fragment) {
    return err(`The new text for ${input.ref} matches its current text.`);
  }
  return ok({ ...before, fragment, type: "revise" });
};

export const propose = async (
  memory: MemoryService,
  signal: AbortSignal
): Promise<
  Result<{ proposals: Proposal[]; summary: string }, MemoryUnavailable>
> => {
  if ((await memory.count()) === 0) {
    return ok({ proposals: [], summary: "" });
  }
  const subject = createRunner(env.DEEPSEEK_API_KEY, env.DEEPSEEK_BASE_URL);
  if (!subject) {
    return err(failed("The DeepSeek model is not available"));
  }
  const { settings } = await memory.settings();
  const { fragments } = await memory.readLog({});
  const current = new Map(fragments.map((each) => [each.ref, each]));
  const claimed = new Set<string>();
  const proposals: Proposal[] = [];

  const tool: AgentTool<typeof PROPOSE_CHANGE.parameters> = {
    ...PROPOSE_CHANGE,
    execute: (_toolCallId, input) => {
      if (proposals.length >= MAX_PROPOSALS) {
        return Promise.resolve(
          toolResult("This run has reached its proposal limit.", true)
        );
      }
      const changes: Change[] = [];
      const refs = new Set(claimed);
      for (const each of input.changes) {
        const described = describeChange(
          each,
          current,
          refs,
          settings.length.refuse
        );
        if (!described.ok) {
          return Promise.resolve(toolResult(described.error, true));
        }
        changes.push(described.value);
        if (described.value.type !== "remember") {
          refs.add(described.value.ref);
        }
      }
      for (const ref of refs) {
        claimed.add(ref);
      }
      proposals.push({
        changes,
        id: crypto.randomUUID(),
        reason: input.reason.trim(),
      });
      return Promise.resolve(
        toolResult(`Recorded proposal ${proposals.length}.`)
      );
    },
  };

  let turns = 0;
  try {
    const last = await run(subject, {
      finishTurn: () => {
        turns += 1;
        return turns >= MAX_TURNS ? { action: "end" as const } : undefined;
      },
      message: `Current time: ${new Date().toISOString()}\n\n${TAIL}`,
      signal,
      system: await prepareSystemPrompt(memory, settings.instructions),
      toolChoice: "auto",
      tools: [tool],
    });
    const failure = errorOf(last);
    if (failure !== undefined) {
      return err(failed(failure));
    }
    return ok({ proposals, summary: last ? textOf(last) : "" });
  } catch (error) {
    return err(failed(error instanceof Error ? error.message : String(error)));
  }
};
