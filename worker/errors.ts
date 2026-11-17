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
  "The memory model could not answer. Retry this call shortly.";
export const MEMORY_RETRY_APPLIED =
  "The memory model could not answer. Retry this call shortly; changes already made stay.";

const failureMessage = (retry: boolean, applied: string | undefined) => {
  if (!retry) {
    return MEMORY_UNAVAILABLE;
  }
  return applied ? MEMORY_RETRY_APPLIED : MEMORY_RETRY;
};

export const memoryUnavailable = (
  retry: boolean,
  applied?: string
): MemoryUnavailable => ({
  code: "unavailable",
  message: [applied, failureMessage(retry, applied)].filter(Boolean).join(" "),
  reason: "memory-unavailable",
  retry,
});
