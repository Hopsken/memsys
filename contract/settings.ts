// The owner's choices under Settings → Features. Per instance; agents never
// see them. Types only; no local imports.

export type Strictness = "low" | "medium" | "high" | "max";

export interface Settings {
  // Memory length in characters: above `warn` a write is saved with a nudge
  // to split it, above `refuse` it is refused.
  length: { warn: number; refuse: number };
  // How much the relevance filter hides from a recall; "off" skips it.
  relevanceFilter: "off" | Strictness;
}

export interface SettingsView {
  settings: Settings;
  defaults: Settings;
}

// A JSON Merge Patch: each field given is a whole new value, or null to
// return it to its default. Fields left out stay as they are.
export type SettingsPatch = { [K in keyof Settings]?: Settings[K] | null };
