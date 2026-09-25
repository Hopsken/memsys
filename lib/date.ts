import { format, isSameDay, isSameYear, subDays } from "date-fns";

// Shared by client and worker. "Today", "Yesterday", "May 5", or "Apr 1, 2025" outside the current year.
// `now` is injectable so callers and tests control what "today" means.
export const formatRelativeDate = (
  value: Date | string,
  now: Date = new Date()
) => {
  const date = new Date(value);
  if (isSameDay(date, now)) {
    return "Today";
  }
  if (isSameDay(date, subDays(now, 1))) {
    return "Yesterday";
  }
  return format(date, isSameYear(date, now) ? "MMM d" : "MMM d, yyyy");
};

// The same date inside a sentence: "Connected today", "Connected on May 5".
export const formatRelativeDateInline = (
  value: Date | string,
  now: Date = new Date()
) => {
  const text = formatRelativeDate(value, now);
  return text === "Today" || text === "Yesterday"
    ? text.toLowerCase()
    : `on ${text}`;
};
