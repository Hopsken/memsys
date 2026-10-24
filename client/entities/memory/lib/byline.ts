import type { Author } from "@/shared/api";

export const byline = (by: Author | null) => {
  if (by === null) {
    return null;
  }
  if (by === "user") {
    return "by you";
  }
  const name = by.slice("agent:".length).trim();
  return name ? `by ${name}` : "by an AI tool";
};
