import { cn } from "cn";

// A list item on a white card, just off the page background. Cards reach
// past the column, so their text lines up with the header.
export const listCard =
  "bg-card -mx-3 space-y-1 rounded-xl px-3 py-3 sm:-mx-4 sm:px-4";

// A card that opens something lifts a little when hovered.
export const listCardLink = cn(
  listCard,
  "cursor-pointer transition-shadow duration-200 hover:shadow-md hover:shadow-black/5"
);
