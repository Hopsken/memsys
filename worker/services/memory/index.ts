import type { Fragment, ImportFormat, Memory, Metadata, Source } from "@core";
import { z } from "zod";

import { fragmentLength } from "@lib/fragment";
import { err, ok } from "@lib/result";
import type { Result } from "@lib/result";

import type { TooLong } from "../../errors";
import { SettingsService } from "../settings";
import type { Settings } from "../settings";
import { Subagent } from "./subagent";

export const MAX_CONTEXT = 8000;

export const memoryContextSchema = z.string().trim().min(1).max(MAX_CONTEXT);

export const memoryInputSchema = z
  .object({ context: memoryContextSchema })
  .strict();

export type MemoryInput = z.infer<typeof memoryInputSchema>;

export type Written = Fragment & { warnings?: string[] };

const checkOwnerLengthLimits = (
  { refuse, warn }: Settings["length"],
  text: string
): Result<string | null, TooLong> => {
  const length = fragmentLength(text);
  if (length > refuse) {
    return err({
      code: "invalid",
      message: `Memory contains ${length} characters, above the limit of ${refuse}. Store a conclusion, or store nothing.`,
      reason: "too-long",
    });
  }
  if (length > warn) {
    return ok(
      `Memory contains ${length} characters, above the recommended ${warn}.`
    );
  }
  return ok(null);
};

export class MemoryService {
  readonly #memory: Memory;
  readonly #settings: SettingsService;
  readonly #subagent: Subagent;

  constructor(memory: Memory, apiKey: string, baseUrl?: string) {
    this.#memory = memory;
    this.#settings = new SettingsService(memory);
    this.#subagent = new Subagent(this, apiKey, baseUrl);
  }

  async remember(input: { fragment: string }, source: Source) {
    return await this.#write(input.fragment, () =>
      this.#memory.remember(input, source)
    );
  }

  async revise(input: { fragment: string; ref: string }, source: Source) {
    return await this.#write(input.fragment, () =>
      this.#memory.revise(input, source)
    );
  }

  async forget(input: { ref: string }, source: Source) {
    return await this.#memory.forget(input, source);
  }

  async restore(input: { id: number; ref: string }) {
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

  async readLog(input: Parameters<Memory["readLog"]>[0]) {
    return await this.#memory.readLog(input);
  }

  async count() {
    return await this.#memory.count();
  }

  async readMetadata(key: string) {
    return await this.#memory.readMetadata(key);
  }

  async patchMetadata(key: string, patch: Metadata) {
    return await this.#memory.patchMetadata(key, patch);
  }

  async history(input: { ref: string }) {
    return await this.#memory.history(input);
  }

  async activity(input: Parameters<Memory["activity"]>[0]) {
    return await this.#memory.activity(input);
  }

  async sources() {
    return await this.#memory.sources();
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

  async recall(input: MemoryInput, source: Source) {
    return await this.#subagent.recall(input.context, source);
  }

  async note(input: MemoryInput, source: Source) {
    return await this.#subagent.note(input.context, source);
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
