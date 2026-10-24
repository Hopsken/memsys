import type { Memory, SeedFragment } from "@core";
import { env } from "cloudflare:workers";

import type { Author } from "@contract/memory";

import { relevanceJudge } from "../clients/workers-ai";
import { MemoryService } from "../services/memory";

// A memory space id names one memory object. Each user has a default space
// whose id is their user id; this is the only place that ties the two, so
// more spaces per user, or another sign-in system, change only this.
export const defaultSpace = (userId: string) => userId;

// The only place the Worker touches the MEMORY binding; lint keeps it so.
// Everything else gets a MemoryService, so no call skips its rules.
const stub = (spaceId: string): Memory =>
  // SAFETY: the stub has MemoryDO's methods, which implement MemoryCore,
  // each returning a Promise of its result; TypeScript cannot check the RPC
  // types against Memory without recursing too deep.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  env.MEMORY.getByName(spaceId) as unknown as Memory;

export const openMemory = (spaceId: string, by: Author) =>
  new MemoryService(stub(spaceId), { by, judge: relevanceJudge });

// Development only: replaces the space with the seed corpus.
export const seedSpace = (spaceId: string, corpus: SeedFragment[]) =>
  env.MEMORY.getByName(spaceId).seed(corpus);
