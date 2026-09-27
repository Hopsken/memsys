import type { Author } from "@contract/memory";

// Who wrote a record, as a phrase after its label; nothing for records from
// before this was kept.
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
