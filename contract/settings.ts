export type Strictness = "low" | "medium" | "high" | "max";

export interface Settings {
  length: { warn: number; refuse: number };
  relevanceFilter: "off" | Strictness;
}

export interface SettingsView {
  settings: Settings;
  defaults: Settings;
}

export type SettingsMergePatch = { [K in keyof Settings]?: Settings[K] | null };
