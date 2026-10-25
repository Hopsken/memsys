import type { Author, Persona } from "@/shared/api";

export interface AuthorLabel {
  archived: boolean;
  name: string;
}

export const isAuthor = (value: string | null): value is Author =>
  value !== null &&
  (value === "user" ||
    value.startsWith("agent:") ||
    value.startsWith("persona:"));

// Null while the personas are still loading, so a persona's id never shows.
export const authorLabel = (
  by: Author,
  personas: Persona[] | undefined
): AuthorLabel | null => {
  if (by === "user") {
    return { archived: false, name: "you" };
  }
  if (by.startsWith("persona:")) {
    if (!personas) {
      return null;
    }
    const persona = personas.find(({ id }) => `persona:${id}` === by);
    return persona
      ? { archived: persona.archivedAt !== null, name: persona.name }
      : { archived: false, name: "an unknown agent" };
  }
  const name = by.slice("agent:".length).trim();
  return { archived: false, name: name || "an AI tool" };
};
