import { cn } from "cn";

export const listCard =
  "bg-card -mx-3 space-y-1 rounded-xl px-3 py-3 sm:-mx-4 sm:px-4";

export const listCardLink = cn(
  listCard,
  "cursor-pointer transition-shadow duration-200 hover:shadow-xs"
);
