import type { Memory } from "@core";

import type {
  Author,
  Fragment,
  ImportFormat,
  JsonObject,
  RecallInput,
} from "@contract/memory";
import { err, ok } from "@contract/result";
import type { Result } from "@contract/result";
import type { Settings } from "@contract/settings";
import { fragmentLength } from "@lib/fragment";

import type { TooLong } from "../errors";
import { recall } from "./recall";
import type { Judge } from "./recall";
import { readSettings, updateSettings, viewSettings } from "./settings";

export type Written = Fragment & { warnings?: string[] };

// The owner's length limits on what agents write: a warning above `warn`,
// a refusal above `refuse`.
const checkLength = (
  { refuse, warn }: Settings["length"],
  text: string
): Result<string | null, TooLong> => {
  const length = fragmentLength(text);
  if (length > refuse) {
    return err({
      code: "invalid",
      message: `Fragment contains ${length} characters, above the limit of ${refuse}. Split it into smaller fragments.`,
      reason: "too-long",
    });
  }
  if (length > warn) {
    return ok(
      `Fragment contains ${length} characters, above the recommended ${warn}. Consider splitting it into smaller fragments.`
    );
  }
  return ok(null);
};

// One caller's memory space, with the Worker's rules applied. Routes and
// MCP tools reach the core only through this class, so no write can skip
// the owner's limits.
export class MemoryService {
  readonly #memory: Memory;
  readonly #by: Author;
  readonly #judge: Judge;

  constructor(memory: Memory, { by, judge }: { by: Author; judge: Judge }) {
    this.#memory = memory;
    this.#by = by;
    this.#judge = judge;
  }

  async remember(input: { fragment: string }) {
    return await this.#write(input.fragment, () =>
      this.#memory.remember(input, this.#by)
    );
  }

  async revise(input: { fragment: string; ref: string }) {
    return await this.#write(input.fragment, () =>
      this.#memory.revise(input, this.#by)
    );
  }

  async forget(input: { ref: string }) {
    return await this.#memory.forget(input, this.#by);
  }

  async restore(input: { at: number; ref: string }) {
    return await this.#memory.restore(input);
  }

  // The user's own actions: purge and import are never an agent's, and
  // import keeps what the old instance accepted, so no length limits.
  async purge(input: { ref: string }) {
    return await this.#memory.purge(input);
  }

  async importLog(input: { content: string; format: ImportFormat }) {
    return await this.#memory.importLog(input);
  }

  async exportLog(input: { history: boolean }) {
    return await this.#memory.exportLog(input);
  }

  async list(input: Parameters<Memory["list"]>[0]) {
    return await this.#memory.list(input);
  }

  async history(input: { ref: string }) {
    return await this.#memory.history(input);
  }

  async activity(input: { cursor?: string | undefined }) {
    return await this.#memory.activity(input);
  }

  async forgotten() {
    return await this.#memory.forgotten();
  }

  async recall(input: RecallInput) {
    return await recall({ judge: this.#judge, memory: this.#memory }, input);
  }

  // Every #anchor in use, sorted.
  async listTags() {
    const anchors = await this.#memory.anchors();
    return anchors.map(({ anchor }) => anchor);
  }

  async settings() {
    return await viewSettings(this.#memory);
  }

  async updateSettings(patch: JsonObject) {
    return await updateSettings(this.#memory, patch);
  }

  async #write<E>(
    text: string,
    store: () => Promise<Result<Fragment, E>> | Result<Fragment, E>
  ): Promise<Result<Written, E | TooLong>> {
    const { length } = await readSettings(this.#memory);
    const checked = checkLength(length, text);
    if (!checked.ok) {
      return checked;
    }
    const stored = await store();
    if (!stored.ok) {
      return err(stored.error);
    }
    return ok(
      checked.value === null
        ? stored.value
        : { ...stored.value, warnings: [checked.value] }
    );
  }
}
