import type { Memory } from "@core";
import { env } from "cloudflare:workers";

export const defaultSpace = (userId: string) => userId;

export const memoryOf = (spaceId: string): Memory =>
  // SAFETY: the stub has MemoryDO's methods, which implement MemoryCore,
  // each returning a Promise of its result; TypeScript cannot check the RPC
  // types against Memory without recursing too deep.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  env.MEMORY.getByName(spaceId) as unknown as Memory;
