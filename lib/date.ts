import { format, isSameDay, isSameYear, subDays } from "date-fns";

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

export const formatRelativeDateInline = (
  value: Date | string,
  now: Date = new Date()
) => {
  const text = formatRelativeDate(value, now);
  return text === "Today" || text === "Yesterday"
    ? text.toLowerCase()
    : `on ${text}`;
};
