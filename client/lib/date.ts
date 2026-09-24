import { format, isSameDay, isSameYear, subDays } from "date-fns";

// "Today", "Yesterday", "May 5", or "Apr 1, 2025" outside the current year.
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
