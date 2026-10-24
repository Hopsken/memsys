import type { Memory } from "@core";
import { z } from "zod";

import type { Json, JsonObject } from "@contract/memory";
import { err, ok } from "@contract/result";
import type { Result } from "@contract/result";
import type { Settings, SettingsView } from "@contract/settings";
import { FRAGMENT_MAX, fragmentLength } from "@lib/fragment";

import type { InvalidSettings, TooLong } from "../errors";

// The owner's settings are one metadata document in the core.
const KEY = "settings";

const characters = z.int().min(1).max(FRAGMENT_MAX);

// Each field is stored, defaulted, and checked on its own.
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

// A JSON Merge Patch over the stored settings: a field is a whole new value,
// or null to return it to its default.
const settingsPatch = z
  .object({
    length: fields.length.nullable().optional(),
    relevanceFilter: fields.relevanceFilter.nullable().optional(),
  })
  .strict();

// Stored settings with a default for every field missing or no longer valid.
const parseSettings = (stored: Json | undefined): Settings => {
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

export const readSettings = async (
  memory: Pick<Memory, "readMetadata">
): Promise<Settings> =>
  parseSettings((await memory.readMetadata(KEY)) ?? undefined);

export const viewSettings = async (
  memory: Pick<Memory, "readMetadata">
): Promise<SettingsView> => ({
  defaults: DEFAULT_SETTINGS,
  settings: await readSettings(memory),
});

// Applies the owner's change; the last save of a field wins.
export const updateSettings = async (
  memory: Pick<Memory, "patchMetadata">,
  patch: JsonObject
): Promise<Result<SettingsView, InvalidSettings>> => {
  const parsed = settingsPatch.safeParse(patch);
  if (!parsed.success) {
    return err({
      issues: parsed.error.issues.map(({ message, path }) => ({
        message,
        path: path.map(String),
      })),
      kind: "invalid-settings",
    });
  }
  // SAFETY: the parsed patch holds only JSON: numbers, strings, and null.
  const stored = await memory.patchMetadata(KEY, parsed.data as JsonObject);
  return ok({ defaults: DEFAULT_SETTINGS, settings: parseSettings(stored) });
};

// The owner's length limits on what agents write: a warning above `warn`,
// a refusal above `refuse`.
export const checkLength = (
  { refuse, warn }: Settings["length"],
  text: string
): Result<string | null, TooLong> => {
  const length = fragmentLength(text);
  if (length > refuse) {
    return err({ kind: "too-long", length, limit: refuse });
  }
  if (length > warn) {
    return ok(
      `Fragment contains ${length} characters, above the recommended ${warn}. Consider splitting it into smaller fragments.`
    );
  }
  return ok(null);
};
