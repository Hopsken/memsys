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

const TAIL = `Review the whole memory above as its maintainer. Memory keeps what an agent with no history would get wrong: what the person prefers, the people, places, and projects in their life, and what happened and what they learned from it. Your job is to keep it true and easy to use for years, without losing any of it. Fix each defect below that you find, and nothing else, because the person may accept your proposals without reading each one closely.

Propose changes for these defects:
- Two memories hold the same idea: revise one so it keeps every detail of both, and forget the other.
- A later memory corrects or replaces an earlier one: revise the earlier one into history that stays true, such as "Used VS Code until October 2026", or forget it when the later memory already says what changed. The person's own words win over an agent's, and a later date alone does not settle a conflict. When you cannot tell which is right, change neither.
- A memory states as the person's decision what another memory shows was only an agent's suggestion: revise it to say who suggested what.
- A memory copies what can be found again elsewhere, such as code, docs, commits, benchmark results, a vendor's documentation, or entries read from a calendar, inbox, or issue tracker: revise it to what that source cannot tell, such as the decision, the result, or why it matters to the person, plus where to find the rest, and drop the details the source keeps. Keep every path, URL, commit, or tool it names, and do not invent one. What the person said is never such a copy, even when the same thing is in their calendar. Forget it only when nothing is left that is about the person, such as general knowledge any model has.
- A memory says "last month", "next week", or another time relative to when it was written: revise it to the date it means, counted from its written time.
- A memory holds ideas that would go out of date separately: revise it to one of them and remember each of the others. The details of one thing, such as a name, a place, and a date, are one idea.

Leave everything else as it is:
- Never forget a memory because its date has passed. Past trips, appointments, plans, and deadlines are what happened, and the people, places, and lessons in them still matter. Do not guess how a plan turned out.
- Do not reword a memory only to make it shorter, clearer, or more consistent, and do not merge memories that say different things about one topic.
- A revise keeps every name, date, number, reason, pointer, and doubt that still holds, and adds nothing that no memory states.

Each propose_change call is one proposal that the person accepts or rejects as a whole. Put only changes that depend on each other in one proposal, such as merging two duplicates, or splitting one memory. Give each proposal a one-sentence reason that tells the person what is wrong.

When memory needs no change, propose nothing. Finish with one short sentence about what you found, including any conflict you left for the person to settle.`;

const PROPOSE_CHANGE = {
  description:
    "Propose one fix for the person to review: the edits to memory that they accept or reject together. Nothing changes until they accept it. Each memory can be in one proposal only.",
  label: "Propose change",
  name: "propose_change",
  parameters: obj({
    changes: arr(
      obj({
        fragment: opt(
          str({
            description:
              "For remember and revise: the full new memory text, one short idea. A revise replaces the whole old text, so keep every detail that still holds.",
          })
        ),
        ref: opt(
          str({
            description:
              "For revise and forget: the ref shown in square brackets on the memory to change, without the brackets.",
          })
        ),
        type: oneOf(["remember", "revise", "forget"]),
      }),
      { maxItems: MAX_CHANGES_PER_PROPOSAL, minItems: 1 }
    ),
    reason: str({
      description:
        "One sentence telling the person what is wrong, in plain words.",
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
    current: target.fragment,
    ref: input.ref,
    source: target.source,
    versionId: target.versionId,
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
