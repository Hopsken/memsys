export type Strictness = "low" | "medium" | "high" | "max";

export interface Settings {
  length: { warn: number; refuse: number };
  relevanceFilter: "off" | Strictness;
}

export interface SettingsView {
  settings: Settings;
  defaults: Settings;
}

// A JSON Merge Patch: each field given is a whole new value, or null to
// return it to its default. Fields left out stay as they are.
export type SettingsPatch = { [K in keyof Settings]?: Settings[K] | null };
