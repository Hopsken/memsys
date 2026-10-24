import type { Memory, SeedFragment } from "@core";
import { env } from "cloudflare:workers";

import type { Author } from "@contract/memory";

import { relevanceJudge } from "../clients/workers-ai";
import { MemoryService } from "../services/memory";

export const defaultSpace = (userId: string) => userId;

const memoryObject = (spaceId: string): Memory =>
  // SAFETY: the stub has MemoryDO's methods, which implement MemoryCore,
  // each returning a Promise of its result; TypeScript cannot check the RPC
  // types against Memory without recursing too deep.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  env.MEMORY.getByName(spaceId) as unknown as Memory;

export const openMemory = (spaceId: string, by: Author) =>
  new MemoryService(memoryObject(spaceId), { by, judge: relevanceJudge });

export const seedSpace = (spaceId: string, corpus: SeedFragment[]) =>
  env.MEMORY.getByName(spaceId).seed(corpus);
