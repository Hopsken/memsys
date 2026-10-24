import type { Memory, Metadata } from "@core";
import { z } from "zod";

import { err, ok } from "@contract/result";
import type { Result } from "@contract/result";
import type { Settings, SettingsView } from "@contract/settings";
import { FRAGMENT_MAX } from "@lib/fragment";

import type { InvalidSettings } from "../errors";

const SETTINGS_KEY = "settings";

const characters = z.int().min(1).max(FRAGMENT_MAX);

const fields = {
  length: z
    .object({ refuse: characters, warn: characters })
    .refine((value) => value.warn <= value.refuse, {
      message: "Can’t be higher than Refuse above.",
      path: ["warn"],
    }),
  relevanceFilter: z.enum(["off", "low", "medium", "high", "max"]),
} satisfies { [K in keyof Settings]: z.ZodType<Settings[K]> };

export const DEFAULT_SETTINGS: Settings = {
  length: { refuse: 500, warn: 300 },
  relevanceFilter: "off",
};

const settingsPatch = z
  .object({
    length: fields.length.nullable().optional(),
    relevanceFilter: fields.relevanceFilter.nullable().optional(),
  })
  .strict();

const parseSettings = (stored: Metadata | null): Settings => {
  const value = z.record(z.string(), z.json()).safeParse(stored).data ?? {};
  const field = <K extends keyof Settings>(key: K): Settings[K] => {
    if (value[key] === undefined) {
      return DEFAULT_SETTINGS[key];
    }
    const parsed = fields[key].safeParse(value[key]);
    if (!parsed.success) {
      console.error({
        error: z.prettifyError(parsed.error),
        event: "settings.invalid",
        field: key,
      });
      return DEFAULT_SETTINGS[key];
    }
    // SAFETY: each field's schema is typed against its Settings field above.
    return parsed.data as Settings[K];
  };
  return { length: field("length"), relevanceFilter: field("relevanceFilter") };
};

export class SettingsService {
  readonly #memory: Pick<Memory, "patchMetadata" | "readMetadata">;

  constructor(memory: Pick<Memory, "patchMetadata" | "readMetadata">) {
    this.#memory = memory;
  }

  async read(): Promise<Settings> {
    return parseSettings(await this.#memory.readMetadata(SETTINGS_KEY));
  }

  async view(): Promise<SettingsView> {
    return { defaults: DEFAULT_SETTINGS, settings: await this.read() };
  }

  async update(
    patch: Metadata
  ): Promise<Result<SettingsView, InvalidSettings>> {
    const parsed = settingsPatch.safeParse(patch);
    if (!parsed.success) {
      return err({
        code: "invalid",
        issues: parsed.error.issues.map(({ message, path }) => ({
          message,
          path: path.map(String),
        })),
        message: "Invalid settings",
        reason: "invalid-settings",
      });
    }
    const stored = await this.#memory.patchMetadata(SETTINGS_KEY, patch);
    return ok({ defaults: DEFAULT_SETTINGS, settings: parseSettings(stored) });
  }
}
