import type { Persona, Source } from "@/shared/api";

export interface SourceLabel {
  name: string;
}

export const isSource = (value: string | null): value is Source =>
  value !== null &&
  (value === "user" ||
    value.startsWith("agent:") ||
    value.startsWith("persona:"));

// Null while the personas are still loading, so a persona's id never shows.
export const sourceLabel = (
  from: Source,
  personas: Persona[] | undefined
): SourceLabel | null => {
  if (from === "user") {
    return { name: "you" };
  }
  if (from.startsWith("persona:")) {
    if (!personas) {
      return null;
    }
    const persona = personas.find(({ id }) => `persona:${id}` === from);
    return { name: persona?.name ?? "an unknown agent" };
  }
  const name = from.slice("agent:".length).trim();
  return { name: name || "an AI tool" };
};
