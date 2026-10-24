import type { Memory } from "@core";
import { env } from "cloudflare:workers";

// A memory space id names one memory object. Each user has a default space
// whose id is their user id; this is the only place that ties the two, so
// more spaces per user, or another sign-in system, change only this.
export const defaultSpace = (userId: string) => userId;

export const memoryOf = (spaceId: string): Memory =>
  // SAFETY: the stub has MemoryDO's methods, which implement MemoryCore,
  // each returning a Promise of its result; TypeScript cannot check the RPC
  // types against Memory without recursing too deep.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  env.MEMORY.getByName(spaceId) as unknown as Memory;
