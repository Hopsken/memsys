import type { Author, Fragment, ImportFormat, Memory, Metadata } from "@core";

import { fragmentLength } from "@lib/fragment";
import { err, ok } from "@lib/result";
import type { Result } from "@lib/result";

import type { TooLong } from "../../errors";
import { SettingsService } from "../settings";
import type { Settings } from "../settings";
import { recall } from "./recall";
import type { Judge, RecallInput } from "./recall";

export {
  recallContextSchema,
  recallCuesSchema,
  recallInputSchema,
} from "./recall";

export type Written = Fragment & { warnings?: string[] };

const checkOwnerLengthLimits = (
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

export class MemoryService {
  readonly #memory: Memory;
  readonly #settings: SettingsService;
  readonly #judge: Judge;

  constructor(memory: Memory, judge: Judge) {
    this.#memory = memory;
    this.#judge = judge;
    this.#settings = new SettingsService(memory);
  }

  async remember(input: { fragment: string }, by: Author) {
    return await this.#write(input.fragment, () =>
      this.#memory.remember(input, by)
    );
  }

  async revise(input: { fragment: string; ref: string }, by: Author) {
    return await this.#write(input.fragment, () =>
      this.#memory.revise(input, by)
    );
  }

  async forget(input: { ref: string }, by: Author) {
    return await this.#memory.forget(input, by);
  }

  async restore(input: { at: number; ref: string }) {
    return await this.#memory.restore(input);
  }

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

  async activity(input: Parameters<Memory["activity"]>[0]) {
    return await this.#memory.activity(input);
  }

  async authors() {
    return await this.#memory.authors();
  }

  async personas() {
    return await this.#memory.personas();
  }

  async createPersona(input: { name: string }) {
    return await this.#memory.createPersona(input);
  }

  async renamePersona(input: { id: string; name: string }) {
    return await this.#memory.renamePersona(input);
  }

  async setPersonaArchived(input: { archived: boolean; id: string }) {
    return await this.#memory.setPersonaArchived(input);
  }

  async forgotten() {
    return await this.#memory.forgotten();
  }

  async recall(input: RecallInput) {
    return await recall(this.#memory, input, this.#judge);
  }

  async listTags() {
    const anchors = await this.#memory.anchors();
    return anchors.map(({ anchor }) => anchor);
  }

  async settings() {
    return await this.#settings.view();
  }

  async updateSettings(patch: Metadata) {
    return await this.#settings.update(patch);
  }

  async diagnostics() {
    const memory = await this.#memory.diagnostics();
    const started = Date.now();
    await this.#memory.count();
    return { ...memory, roundTripMs: Date.now() - started };
  }

  async #write<E>(
    text: string,
    store: () => Promise<Result<Fragment, E>>
  ): Promise<Result<Written, E | TooLong>> {
    const { length } = await this.#settings.read();
    const checked = checkOwnerLengthLimits(length, text);
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
