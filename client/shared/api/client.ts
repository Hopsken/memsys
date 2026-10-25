import { hc } from "hono/client";
import type { InferResponseType } from "hono/client";
import ky, { isHTTPError } from "ky";
import * as z from "zod/mini";

import type { Api } from "@worker/api";

export const http = ky.create({ cache: "no-store", retry: 0 });

export const api = hc<Api>("/api", {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => http(input, init),
});

export type FragmentPage = InferResponseType<typeof api.fragments.$get, 200>;
export type ListedFragment = FragmentPage["fragments"][number];
export type History = InferResponseType<
  (typeof api.fragments)[":ref"]["history"]["$get"],
  200
>;
export type Version = History["versions"][number];
export type Op = Version["op"];
export type Author = NonNullable<Version["by"]>;
export type Restored = InferResponseType<
  (typeof api.fragments)[":ref"]["restore"]["$post"],
  200
>;
export type ActivityPage = InferResponseType<typeof api.activity.$get, 200>;
export type ActivityEntry = ActivityPage["entries"][number];
export type ForgottenList = InferResponseType<
  typeof api.fragments.forgotten.$get,
  200
>;
export type ForgottenFragment = ForgottenList["fragments"][number];
export type ImportResult = InferResponseType<typeof api.import.$post, 200>;
export type RecallResult = InferResponseType<typeof api.recall.$post, 200>;
export type RecallItem = RecallResult["fragments"][number];
export type SettingsView = InferResponseType<typeof api.settings.$get, 200>;
export type Settings = SettingsView["settings"];
export type Strictness = Settings["relevanceFilter"];
export type SettingsMergePatch = {
  [K in keyof Settings]?: Settings[K] | null;
};
export type Connection = InferResponseType<
  typeof api.connections.$get,
  200
>[number];

const problemSchema = z.object({
  error: z.optional(z.string()),
  issues: z.optional(
    z.array(z.object({ message: z.string(), path: z.array(z.string()) }))
  ),
  message: z.optional(z.string()),
  retry: z.optional(z.boolean()),
});
type Problem = z.infer<typeof problemSchema>;

interface Failure {
  expired: boolean;
  problem: Problem;
  status: number | null;
}

export const failure = (error: Error): Failure => {
  if (!isHTTPError(error)) {
    return { expired: false, problem: {}, status: null };
  }
  const { status } = error.response;
  return {
    expired: status === 401,
    problem: z.safeParse(problemSchema, error.data).data ?? {},
    status,
  };
};

export const isRetryable = (error: Error) => {
  const { problem, status } = failure(error);
  return problem.retry !== false && (status === null || status >= 500);
};

export const isExpired = (error: Error | null) =>
  error !== null && failure(error).expired;
