import { hc } from "hono/client";
import type { InferResponseType } from "hono/client";

import type { Api } from "@worker/api";

import { api } from "./client";

// Calls go through ky, so a failed request throws the same HTTPError as
// every other call; `parseResponse` then only sees successes.
export const rpc = hc<Api>("/api", {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => api(input, init),
});

export type FragmentPage = InferResponseType<typeof rpc.fragments.$get, 200>;
export type ListedFragment = FragmentPage["fragments"][number];
export type History = InferResponseType<
  (typeof rpc.fragments)[":ref"]["history"]["$get"],
  200
>;
export type Version = History["versions"][number];
export type Op = Version["op"];
export type Author = NonNullable<Version["by"]>;
export type Restored = InferResponseType<
  (typeof rpc.fragments)[":ref"]["restore"]["$post"],
  200
>;
export type ActivityPage = InferResponseType<typeof rpc.activity.$get, 200>;
export type ActivityEntry = ActivityPage["entries"][number];
export type ForgottenList = InferResponseType<
  typeof rpc.fragments.forgotten.$get,
  200
>;
export type ForgottenFragment = ForgottenList["fragments"][number];
export type ImportResult = InferResponseType<typeof rpc.import.$post, 200>;
export type RecallResult = InferResponseType<typeof rpc.recall.$post, 200>;
export type RecallItem = RecallResult["fragments"][number];
export type SettingsView = InferResponseType<typeof rpc.settings.$get, 200>;
export type Settings = SettingsView["settings"];
export type Strictness = Exclude<Settings["relevanceFilter"], "off">;
export type SettingsMergePatch = {
  [K in keyof Settings]?: Settings[K] | null;
};
export type Connection = InferResponseType<
  typeof rpc.connections.$get,
  200
>[number];
