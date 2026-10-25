import type { Memory, Metadata } from "@core";
import { z } from "zod";

import { FRAGMENT_MAX } from "@lib/fragment";
import { err, ok } from "@lib/result";
import type { Result } from "@lib/result";

import type { InvalidSettings } from "../errors";

export type Strictness = "low" | "medium";

export interface Settings {
  instructions: string;
  length: { warn: number; refuse: number };
  relevanceFilter: Strictness;
}

export interface SettingsView {
  settings: Settings;
  defaults: Settings;
}

const SETTINGS_KEY = "settings";

const charactersSchema = z.int().min(1).max(FRAGMENT_MAX);

const INSTRUCTIONS_MAX = 500;

const fields = {
  instructions: z
    .string()
    .max(
      INSTRUCTIONS_MAX,
      `Too long. Keep it to ${INSTRUCTIONS_MAX} characters.`
    ),
  length: z
    .object({ refuse: charactersSchema, warn: charactersSchema })
    .refine((value) => value.warn <= value.refuse, {
      message: "Can’t be higher than Refuse above.",
      path: ["warn"],
    }),
  relevanceFilter: z.enum(["low", "medium"]),
} satisfies { [K in keyof Settings]: z.ZodType<Settings[K]> };

export const DEFAULT_SETTINGS: Settings = {
  instructions: "",
  length: { refuse: 500, warn: 300 },
  relevanceFilter: "low",
};

const settingsPatchSchema = z
  .object({
    instructions: fields.instructions.nullable().optional(),
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
  return {
    instructions: field("instructions"),
    length: field("length"),
    relevanceFilter: field("relevanceFilter"),
  };
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
    const parsed = settingsPatchSchema.safeParse(patch);
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
