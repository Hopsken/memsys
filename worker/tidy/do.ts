import { DurableObject } from "cloudflare:workers";

import { err, ok } from "@lib/result";
import type { Result } from "@lib/result";

import { openMemory } from "../memory";
import type { MemoryService } from "../services/memory";
import { tidyBusy } from "./model";
import type { Change, Proposal, Skipped, TidyBusy, TidyState } from "./model";
import { propose } from "./propose";

const STATE_KEY = "state";
const SPACE_KEY = "space";
const RUN_DEADLINE_MS = 10 * 60_000;
// An alarm handler stops after 15 minutes; a run older than this has died.
const RUN_LOST_MS = 20 * 60_000;
// Cloudflare retries an interrupted alarm.
const MAX_ATTEMPTS = 2;

const CHANGED = "This memory changed after the review started.";
const INTERRUPTED =
  "Applying stopped before this change. Check Activity before you try again.";

const RUNNING = tidyBusy("memsys is already looking for changes.");
const APPLYING = tidyBusy("memsys is applying changes. Try again shortly.");
const NOTHING_TO_APPLY = tidyBusy("There are no changes to apply.");

const isStale = (proposal: Proposal, current: ReadonlyMap<string, string>) =>
  proposal.changes.some(
    (change) =>
      change.type !== "remember" && current.get(change.ref) !== change.at
  );

const forgetsLast = (proposal: Proposal) =>
  proposal.changes.toSorted(
    (a, b) => Number(a.type === "forget") - Number(b.type === "forget")
  );

const write = (memory: MemoryService, change: Change) => {
  switch (change.type) {
    case "remember": {
      return memory.remember({ fragment: change.fragment }, "system");
    }
    case "revise": {
      return memory.revise(
        { fragment: change.fragment, ref: change.ref },
        "system"
      );
    }
    default: {
      return memory.forget({ ref: change.ref }, "system");
    }
  }
};

const applyProposal = async (
  memory: MemoryService,
  proposal: Proposal
): Promise<string | null> => {
  let written = 0;
  for (const change of forgetsLast(proposal)) {
    // oxlint-disable-next-line no-await-in-loop -- a later write must not run after an earlier one fails.
    const result = await write(memory, change);
    if (!result.ok) {
      return written === 0
        ? result.error.message
        : `${result.error.message} Some of its changes were applied.`;
    }
    written += 1;
  }
  return null;
};

export class TidyDO extends DurableObject<Env> {
  #run: AbortController | null = null;
  #applying = false;

  async read(): Promise<TidyState> {
    const state = await this.#state();
    if (state.status === "applying" && !this.#applying) {
      return await this.#save({
        last: {
          applied: state.done.length,
          skipped: [
            ...state.skipped,
            ...state.proposals
              .filter(
                ({ id }) =>
                  !state.done.includes(id) &&
                  !state.skipped.some(({ proposal }) => proposal.id === id)
              )
              .map((proposal) => ({ proposal, reason: INTERRUPTED })),
          ],
        },
        status: "idle",
      });
    }
    if (
      state.status === "running" &&
      !this.#run &&
      Date.now() - Date.parse(state.startedAt) > RUN_LOST_MS
    ) {
      return await this.#save({
        message: "Looking for changes stopped. Try again.",
        retry: true,
        status: "failed",
      });
    }
    return state;
  }

  async start(space: string): Promise<Result<TidyState, TidyBusy>> {
    await this.ctx.storage.put(SPACE_KEY, space);
    let started = false;
    const result = await this.#update((state) => {
      if (state.status === "running") {
        return ok(state);
      }
      if (state.status === "applying") {
        return err(APPLYING);
      }
      started = true;
      return ok({
        attempts: 0,
        runId: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        status: "running",
      });
    });
    if (started) {
      await this.ctx.storage.setAlarm(Date.now());
    }
    return result;
  }

  async cancel(): Promise<Result<TidyState, TidyBusy>> {
    let wasRunning = false;
    const result = await this.#update((state) => {
      if (state.status === "applying") {
        return err(APPLYING);
      }
      wasRunning = state.status === "running";
      return ok({ status: "idle" });
    });
    if (wasRunning) {
      this.#run?.abort("cancel");
      await this.ctx.storage.deleteAlarm();
    }
    return result;
  }

  async apply(ids: string[]): Promise<Result<TidyState, TidyBusy>> {
    const begun = await this.#update((state) => {
      if (state.status === "running") {
        return err(RUNNING);
      }
      if (state.status === "applying") {
        return err(APPLYING);
      }
      if (state.status !== "ready") {
        return err(NOTHING_TO_APPLY);
      }
      return ok({
        done: [],
        proposals: state.proposals.filter(({ id }) => ids.includes(id)),
        runId: state.runId,
        skipped: [],
        status: "applying",
      });
    });
    if (!begun.ok || begun.value.status !== "applying") {
      return begun;
    }
    const { proposals: chosen, runId } = begun.value;
    const done: string[] = [];
    const skipped: Skipped[] = [];
    this.#applying = true;
    try {
      const memory = openMemory(await this.#space());
      const { fragments } = await memory.readLog({});
      const current = new Map(fragments.map(({ at, ref }) => [ref, at]));
      for (const proposal of chosen) {
        const failure = isStale(proposal, current)
          ? CHANGED
          : // oxlint-disable-next-line no-await-in-loop -- proposals apply one at a time so progress survives an interruption.
            await applyProposal(memory, proposal);
        if (failure === null) {
          done.push(proposal.id);
        } else {
          skipped.push({ proposal, reason: failure });
        }
        // oxlint-disable-next-line no-await-in-loop -- records progress after each proposal.
        await this.#save({
          done,
          proposals: chosen,
          runId,
          skipped,
          status: "applying",
        });
      }
      return ok(
        await this.#save({
          last: { applied: done.length, skipped },
          status: "idle",
        })
      );
    } finally {
      this.#applying = false;
    }
  }

  override async alarm(): Promise<void> {
    const state = await this.#state();
    if (state.status !== "running") {
      return;
    }
    if (state.attempts >= MAX_ATTEMPTS) {
      await this.#save({
        message: "Looking for changes stopped twice. Try again later.",
        retry: true,
        status: "failed",
      });
      return;
    }
    await this.#save({ ...state, attempts: state.attempts + 1 });

    const controller = new AbortController();
    this.#run = controller;
    const timer = setTimeout(
      () => controller.abort("timeout"),
      RUN_DEADLINE_MS
    );
    let result: Awaited<ReturnType<typeof propose>>;
    try {
      result = await propose(
        openMemory(await this.#space()),
        controller.signal
      );
    } finally {
      clearTimeout(timer);
      if (this.#run === controller) {
        this.#run = null;
      }
    }

    const now = await this.#state();
    if (now.status !== "running" || now.runId !== state.runId) {
      return;
    }
    if (controller.signal.reason === "timeout") {
      await this.#save({
        message: "Looking for changes took too long. Try again.",
        retry: true,
        status: "failed",
      });
      return;
    }
    await this.#save(
      result.ok
        ? {
            finishedAt: new Date().toISOString(),
            proposals: result.value.proposals,
            runId: state.runId,
            status: "ready",
            summary: result.value.summary,
          }
        : {
            message: result.error.message,
            retry: result.error.retry,
            status: "failed",
          }
    );
  }

  async #update(
    decide: (state: TidyState) => Result<TidyState, TidyBusy>
  ): Promise<Result<TidyState, TidyBusy>> {
    const decided = decide(await this.read());
    return decided.ok ? ok(await this.#save(decided.value)) : decided;
  }

  async #state(): Promise<TidyState> {
    return (
      (await this.ctx.storage.get<TidyState>(STATE_KEY)) ?? { status: "idle" }
    );
  }

  async #save(state: TidyState): Promise<TidyState> {
    await this.ctx.storage.put(STATE_KEY, state);
    return state;
  }

  async #space(): Promise<string> {
    const space = await this.ctx.storage.get<string>(SPACE_KEY);
    if (space === undefined) {
      throw new Error("A tidy run started without a memory space");
    }
    return space;
  }
}
