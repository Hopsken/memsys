import type { Failure, Issue } from "@lib/result";

export type TooLong = Failure<"invalid", "too-long">;

export type InvalidSettings = Failure<"invalid", "invalid-settings"> & {
  issues: Issue[];
};

export type MemoryUnavailable = Failure<"unavailable", "memory-unavailable"> & {
  retry: boolean;
};

export const MEMORY_UNAVAILABLE =
  "The memory model is unavailable, and retrying will not help. Tell the owner that memsys is down.";
export const MEMORY_RETRY =
  "The memory model could not answer. Retry this call shortly; changes already made stay.";

export const memoryUnavailable = (
  retry: boolean,
  applied?: string
): MemoryUnavailable => ({
  code: "unavailable",
  message: [applied, retry ? MEMORY_RETRY : MEMORY_UNAVAILABLE]
    .filter(Boolean)
    .join(" "),
  reason: "memory-unavailable",
  retry,
});
